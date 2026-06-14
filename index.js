require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const path = require('path');
const Clan = require('./models/Clan');

const app = express();
const PORT = process.env.PORT || 3000;

// الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
    .catch(err => console.error('خطأ في الاتصال بقاعدة البيانات:', err));

// إعدادات البوت الأساسية
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

// إعدادات جلسات تسجيل الدخول للداشبورد
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.REDIRECT_URI,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'clan_secret_session_key',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// جدار حماية للتحقق من تسجيل الدخول للداشبورد
function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', passport.authenticate('discord'));
app.get('/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/dashboard');
});

// صفحة اختيار السيرفرات
app.get('/dashboard', checkAuth, (req, res) => {
    const adminGuilds = req.user.guilds.filter(guild => (guild.permissions & 0x8) === 0x8 || (guild.permissions & 0x20) === 0x20);

    let guildOptions = adminGuilds.map(g => `
        <div style="background:#2b2b2b; padding:15px; margin:10px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
            <span>${g.name}</span>
            <a href="/dashboard/${g.id}" style="background:#0284c7; color:white; padding:8px 12px; text-decoration:none; border-radius:4px; font-weight:bold;">اختيار السيرفر</a>
        </div>
    `).join('');

    if (adminGuilds.length === 0) {
        guildOptions = '<p style="text-align:center; color:#ff4444;">لا تمتلك صلاحية إدارة في أي سيرفر مضاف فيه البوت حالياً.</p>';
    }

    res.send(`
        <html lang="ar" dir="rtl">
        <head><meta charset="UTF-8"><title>اختر السيرفر المراد إدارته</title></head>
        <body style="font-family:sans-serif; background:#121212; color:white; padding:40px;">
            <div style="max-width:600px; margin:0 auto; background:#1e1e1e; padding:20px; border-radius:8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                <h2 style="text-align:center; border-bottom:1px solid #333; padding-bottom:15px; margin-bottom:20px;">اختر السيرفر لإدارة الكلانات</h2>
                ${guildOptions}
            </div>
        </body>
        </html>
    `);
});

app.get('/dashboard/:guildId', checkAuth, (req, res) => {
    const guildId = req.params.guildId;
    const hasPerm = req.user.guilds.some(g => g.id === guildId && ((g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20));
    if (!hasPerm) return res.status(403).send('غير مسموح لك بالوصول لإعدادات هذا السيرفر.');

    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// جلب وتجهيز بيانات الكلانات الـ 8 المخصصة للسيرفر المختار
app.get('/api/clans/:guildId', checkAuth, async (req, res) => {
    const guildId = req.params.guildId;
    try {
        let clans = await Clan.find({ guildId }).sort({ clanIndex: 1 });
        if (clans.length === 0) {
            for (let i = 1; i <= 8; i++) {
                await Clan.create({ clanIndex: i, guildId: guildId });
            }
            clans = await Clan.find({ guildId }).sort({ clanIndex: 1 });
        }
        res.json(clans);
    } catch (err) {
        res.status(500).send('حدث خطأ أثناء جلب بيانات الكلانات.');
    }
});

// تحديث إعدادات الكلان من الداشبورد
app.post('/api/clans/update', checkAuth, async (req, res) => {
    const { guildId, clanIndex, leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName, q1, q2, q3 } = req.body;
    try {
        await Clan.findOneAndUpdate({ guildId, clanIndex: parseInt(clanIndex) }, {
            leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName,
            questions: [q1, q2, q3]
        }, { upsert: true });

        res.redirect('/dashboard/' + guildId);
        updateApplyEmbed(guildId, parseInt(clanIndex));
    } catch (err) {
        res.status(500).send('حدث خطأ أثناء حفظ التعديلات.');
    }
});

async function updateApplyEmbed(guildId, clanIndex) {
    const clan = await Clan.findOne({ guildId, clanIndex });
    if (!clan || !clan.applyChannelId) return;
    const channel = client.channels.cache.get(clan.applyChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(`تقديم الانضمام إلى كلان: ${clan.clanName || 'غير محدد'}`)
        .setDescription(clan.applyContent || 'اضغط على الزر أدناه لبدء المقابلة والتقديم.')
        .setColor(0x0099ff);

    const button = new ButtonBuilder()
        .setCustomId(`apply_btn_${guildId}_${clanIndex}`)
        .setLabel('تقديم طلب انضمام')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (!messages) return;

    const botMsg = messages.find(m => m.author.id === client.user.id);
    if (botMsg) {
        await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => { });
    } else {
        await channel.send({ embeds: [embed], components: [row] }).catch(() => { });
    }
}
// =============================================================
// الجزء الثاني - القسم (أ): أحداث التفاعل ونظام المقابلات
// =============================================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    // معالجة زر التقديم للكلان
    if (interaction.isButton() && interaction.customId.startsWith('apply_btn_')) {
        const parts = interaction.customId.split('_');
        const guildId = parts[2];
        const clanIndex = parseInt(parts[3]);

        const clan = await Clan.findOne({ guildId, clanIndex });
        if (!clan) return interaction.reply({ content: 'حدث خطأ في جلب بيانات الكلان.', ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        // إنشاء خيط محادثة خاص (Private Thread)
        const thread = await interaction.channel.threads.create({
            name: `تقديم ${interaction.user.username}`,
            autoArchiveDuration: 60,
            type: ChannelType.PrivateThread,
            reason: 'طلب تقديم كلان جديد'
        }).catch(() => null);

        if (!thread) return interaction.editReply({ content: 'فشل إنشاء روم التقديم الخاص بك، تأكد من صلاحيات البوت للـ Threads.' });

        await thread.members.add(interaction.user.id);
        await interaction.editReply({ content: `تم فتح نموذج التقديم الخاص بك هنا: ${thread}` });

        const answers = [];
        const questions = clan.questions && clan.questions.filter(q => q.trim() !== '').length ? clan.questions : ['السؤال الأول', 'السؤال الثاني', 'السؤال الثالث'];

        for (let i = 0; i < questions.length; i++) {
            await thread.send({ content: `**السؤال ${i + 1}:** ${questions[i]}` });
            const filter = m => m.author.id === interaction.user.id;

            // استقبال الإجابة من داخل الثريد نفسه
            const collected = await thread.awaitMessages({ filter, max: 1, time: 120000, errors: ['time'] }).catch(() => null);

            if (!collected) {
                await thread.send({ content: 'تم إلغاء التقديم بسبب عدم الرد في الوقت المحدد.' });
                return setTimeout(() => thread.delete().catch(() => { }), 3000);
            }
            answers.push(collected.first().content);
        }

        await thread.send({ content: `تم استلام إجاباتك بنجاح، سيتم مراجعتها من قبل قائد الكلان وقفل هذا القسم تلقائياً.` });
        setTimeout(() => thread.delete().catch(() => { }), 5000);

        // إرسال الطلب لقناة النتائج والقبول المحددة
        const resultsChannel = client.channels.cache.get(clan.resultsChannelId);
        if (resultsChannel) {
            const resultEmbed = new EmbedBuilder()
                .setTitle(`طلب انضمام جديد للكلان: ${clan.clanName}`)
                .setDescription(`مقدم الطلب: <@${interaction.user.id}>\nمعرف الحساب: ${interaction.user.id}`)
                .setColor(0xffff00);

            questions.forEach((q, idx) => {
                resultEmbed.addFields({ name: `جـ ${idx + 1}: ${q}`, value: answers[idx] || 'لا يوجد إجابة' });
            });

            const acceptBtn = new ButtonBuilder().setCustomId(`accept_${interaction.guild.id}_${interaction.user.id}_${clanIndex}`).setLabel('قبول').setStyle(ButtonStyle.Success);
            const rejectBtn = new ButtonBuilder().setCustomId(`reject_${interaction.guild.id}_${interaction.user.id}_${clanIndex}`).setLabel('رفض').setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder().addComponents(acceptBtn, rejectBtn);

            await resultsChannel.send({ embeds: [resultEmbed], components: [row] });
        }
    }

    // معالجة أزرار القبول والرفض من قائد الكلان
    if (interaction.isButton() && (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('reject_'))) {
        const parts = interaction.customId.split('_');
        const action = parts[0];
        const guildId = parts[1];
        const applicantId = parts[2];
        const clanIndex = parseInt(parts[3]);

        const clan = await Clan.findOne({ guildId, clanIndex });
        if (!clan) return interaction.reply({ content: 'الكلان غير متوفر بقاعدة البيانات.', ephemeral: true });

        if (interaction.user.id !== clan.leaderId) {
            return interaction.reply({ content: 'أنت لست قائد هذا الكلان لاتخاذ هذا الإجراء.', ephemeral: true });
        }

        const applicant = await interaction.guild.members.fetch(applicantId).catch(() => null);

        if (action === 'accept') {
            if (applicant && clan.roleId) await applicant.roles.add(clan.roleId).catch(() => { });
            if (applicant) await applicant.send({ content: `تهانينا، لقد تم قبول طلب انضمامك لكلان: ${clan.clanName}` }).catch(() => { });
            await interaction.reply({ content: `تم قبول العضو بنجاح.` });
        } else {
            if (applicant) await applicant.send({ content: `نعتذر منك، لقد تم رفض طلب انضمامك لكلان: ${clan.clanName}` }).catch(() => { });
            await interaction.reply({ content: `تم رفض العضو.` });
        }
        await interaction.message.delete().catch(() => { });
    }
    // معالجة منيو قائمة التحكم الخاصة بالقائد
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('leader_menu_')) {
        const parts = interaction.customId.split('_');
        const guildId = parts[2];
        const clanIndex = parseInt(parts[3]);

        const clan = await Clan.findOne({ guildId, clanIndex });
        if (!clan || interaction.user.id !== clan.leaderId) {
            return interaction.reply({ content: 'غير مسموح لك باستخدام هذه القائمة.', ephemeral: true });
        }

        const selection = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });

        if (selection === 'info') {
            return interaction.editReply({ content: `معلومات الكلان:\nالاسم: ${clan.clanName}\nالنقاط الإجمالية: ${clan.totalPoints} ${clan.pointsName}` });
        }

        if (selection === 'total_points') {
            return interaction.editReply({ content: `نقاط الكلان الكاملة المتراكمة: ${clan.totalPoints} ${clan.pointsName}` });
        }

        if (selection === 'add_member' || selection === 'remove_member' || selection === 'check_member') {
            await interaction.editReply({ content: 'من فضلك قم بكتابة الرقم التعريفي (ID) الخاص بالعضو في الشات الآن:' });

            const filter = m => m.author.id === interaction.user.id;
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 30000 }).catch(() => null);

            if (!collected) return interaction.followUp({ content: 'انتهى الوقت ولم يتم إدخال معرف العضو.', ephemeral: true });

            const targetId = collected.first().content.trim();
            await collected.first().delete().catch(() => { }); // حذف رسالة الـ ID للحفاظ على السرية

            const member = await interaction.guild.members.fetch(targetId).catch(() => null);

            if (selection === 'add_member') {
                if (!member) return interaction.followUp({ content: 'تعذر العثور على هذا العضو في السيرفر.', ephemeral: true });
                if (clan.roleId) await member.roles.add(clan.roleId).catch(() => { });
                return interaction.followUp({ content: `تم إضافة العضو بنجاح وتعيين رتبة الكلان له.`, ephemeral: true });
            }
            if (selection === 'remove_member') {
                if (!member) return interaction.followUp({ content: 'تعذر العثور على هذا العضو في السيرفر.', ephemeral: true });
                if (clan.roleId) await member.roles.remove(clan.roleId).catch(() => { });
                return interaction.followUp({ content: `تم طرد العضو وسحب الرتبة منه بنجاح.`, ephemeral: true });
            }
            if (selection === 'check_member') {
                const currentPts = clan.membersPoints.get(targetId) || 0;
                return interaction.followUp({ content: `نقاط العضو الحالي هي: ${currentPts} ${clan.pointsName}`, ephemeral: true });
            }
        }
    }
});

// -------------------------------------------------------------
// نظام نقاط الشات وأمر التحكم لقائد الكلان
// -------------------------------------------------------------
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // تفعيل أمر "تحكم" لقائد الكلان
    if (message.content === 'تحكم') {
        const clan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
        if (clan && message.author.id === clan.leaderId) {
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`leader_menu_${message.guild.id}_${clan.clanIndex}`)
                .setPlaceholder('اختر الإجراء المطلوب')
                .addOptions([
                    { label: 'معلومات الكلان', value: 'info' },
                    { label: 'اضافة عضو للكلان', value: 'add_member' },
                    { label: 'طرد عضو من الكلان', value: 'remove_member' },
                    { label: 'استعلام عن نقاط عضو بالكلان', value: 'check_member' },
                    { label: 'نقاط الكلان بشكل كامل', value: 'total_points' }
                ]);

            const row = new ActionRowBuilder().addComponents(menu);
            return message.reply({ content: 'لوحة التحكم وإدارة الكلان المخصصة للقائد:', components: [row] });
        }
    }

    // احتساب نقاط تفاعل الشات
    const activeClan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
    if (activeClan) {
        let currentCount = activeClan.messageCounters.get(message.author.id) || 0;
        currentCount++;

        if (currentCount >= 20) {
            activeClan.messageCounters.set(message.author.id, 0);
            let userPoints = activeClan.membersPoints.get(message.author.id) || 0;
            activeClan.membersPoints.set(message.author.id, userPoints + 15);
            activeClan.totalPoints += 15;
        } else {
            activeClan.messageCounters.set(message.author.id, currentCount);
        }
        await activeClan.save();
    }
});

// -------------------------------------------------------------
// نظام نقاط الرومات الصوتية (تحديث كل 20 دقيقة)
// -------------------------------------------------------------
const voiceTimers = new Map();

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.member.user.bot) return;

    const memberId = newState.member.id;
    const guildId = newState.guild.id;

    const newClan = newState.channelId ? await Clan.findOne({ guildId, voiceChannelId: newState.channelId }) : null;
    const oldClan = oldState.channelId ? await Clan.findOne({ guildId, voiceChannelId: oldState.channelId }) : null;

    // الدخول أو الانتقال لروم كلان مخصص
    if (newClan && (!oldClan || oldState.channelId !== newState.channelId)) {
        if (voiceTimers.has(memberId)) {
            clearInterval(voiceTimers.get(memberId));
            voiceTimers.delete(memberId);
        }

        const timer = setInterval(async () => {
            const currentMember = await newState.guild.members.fetch(memberId).catch(() => null);
            if (currentMember && currentMember.voice.channelId === newState.channelId) {
                const updatedClan = await Clan.findOne({ guildId, voiceChannelId: newState.channelId });
                if (updatedClan) {
                    let userPoints = updatedClan.membersPoints.get(memberId) || 0;
                    updatedClan.membersPoints.set(memberId, userPoints + 30);
                    updatedClan.totalPoints += 30;
                    await updatedClan.save();
                }
            }
        }, 20 * 60 * 1000);

        voiceTimers.set(memberId, timer);
    }

    // الخروج من رومات الكلانات
    if (!newState.channelId || (!newClan && oldClan)) {
        if (voiceTimers.has(memberId)) {
            clearInterval(voiceTimers.get(memberId));
            voiceTimers.delete(memberId);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`الداشبورد يعمل بشكل مباشر على المنفذ: ${PORT}`));
