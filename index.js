require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
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

// مسارات التحقق والتوجيه عبر ديسكورد
app.get('/login', passport.authenticate('discord'));
app.get('/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/dashboard');
});

app.get('/dashboard', checkAuth, async (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// جلب وتجهيز بيانات الكلانات الـ 8 للداشبورد تلقائياً
app.get('/api/clans', checkAuth, async (req, res) => {
    try {
        let clans = await Clan.find().sort({ clanIndex: 1 });
        if (clans.length === 0) {
            for (let i = 1; i <= 8; i++) {
                await Clan.create({ clanIndex: i });
            }
            clans = await Clan.find().sort({ clanIndex: 1 });
        }
        res.json(clans);
    } catch (err) {
        res.status(500).send('خطأ في جلب البيانات');
    }
});

// استقبال وتحديث بيانات الكلان المرسلة من الداشبورد
app.post('/api/clans/update', checkAuth, async (req, res) => {
    const { clanIndex, leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName, q1, q2, q3 } = req.body;
    try {
        await Clan.findOneAndUpdate({ clanIndex: parseInt(clanIndex) }, {
            leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName,
            questions: [q1, q2, q3]
        }, { upsert: true });
        
        res.redirect('/dashboard');
        updateApplyEmbed(parseInt(clanIndex));
    } catch (err) {
        res.status(500).send('خطأ في حفظ البيانات');
    }
});

// دالة إرسال وتحديث رسالة التقديم داخل الروم المحدد
async function updateApplyEmbed(clanIndex) {
    const clan = await Clan.findOne({ clanIndex });
    if (!clan || !clan.applyChannelId) return;
    const channel = client.channels.cache.get(clan.applyChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(`تقديم الانضمام إلى كلان: ${clan.clanName || 'غير محدد'}`)
        .setDescription(clan.applyContent || 'اضغط على الزر أدناه لبدء المقابلة والتقديم.')
        .setColor(0x0099ff);

    const button = new ButtonBuilder()
        .setCustomId(`apply_btn_${clanIndex}`)
        .setLabel('تقديم طلب انضمام')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (!messages) return;
    
    const botMsg = messages.find(m => m.author.id === client.user.id);
    if (botMsg) {
        await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => {});
    } else {
        await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }
}
// -------------------------------------------------------------
// أحداث البوت الفردية (تفاعلات التقديم، نقاط الرومات، التحكم)
// -------------------------------------------------------------

// نظام الـ Thread والأسئلة (تفاعل الأزرار والقوائم)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    // معالجة زر التقديم للكلان
    if (interaction.isButton() && interaction.customId.startsWith('apply_btn_')) {
        const clanIndex = parseInt(interaction.customId.replace('apply_btn_', ''));
        const clan = await Clan.findOne({ clanIndex });
        if (!clan) return interaction.reply({ content: 'حدث خطأ في جلب بيانات الكلان.', ephemeral: true });

        await interaction.deferReply({ ephemeral: true });

        // إنشاء خيط محادثة خاص (Private Thread)
        const thread = await interaction.channel.threads.create({
            name: `تقديم ${interaction.user.username}`,
            autoArchiveDuration: 60,
            type: 12, // Private Thread
            reason: 'طلب تقديم كلان جديد'
        });

        await thread.members.add(interaction.user.id);
        await interaction.editReply({ content: `تم فتح نموذج التقديم الخاص بك هنا: ${thread}` });

        const answers = [];
        const questions = clan.questions.length ? clan.questions : ['السؤال الأول', 'السؤال الثاني', 'السؤال الثالث'];

        // مجمع الرسائل لطرح الأسئلة داخل الثريد
        for (let i = 0; i < questions.length; i++) {
            await thread.send({ content: `السؤال ${i + 1}: ${questions[i]}` });
            const filter = m => m.author.id === interaction.user.id;
            const collected = await thread.channel.awaitMessages({ filter, max: 1, time: 120000, errors: ['time'] })
                .catch(() => null);

            if (!collected) {
                await thread.send({ content: 'تم إلغاء التقديم بسبب عدم الرد في الوقت المحدد.' });
                return await thread.delete().catch(() => {});
            }
            answers.push(collected.first().content);
        }

        await thread.send({ content: `تم استلام إجاباتك بنجاح، سيتم مراجعتها من قبل قائد الكلان وقفل هذا القسم تلقائياً.` });
        setTimeout(() => thread.delete().catch(() => {}), 5000);

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

            const acceptBtn = new ButtonBuilder().setCustomId(`accept_${interaction.user.id}_${clanIndex}`).setLabel('قبول').setStyle(ButtonStyle.Success);
            const rejectBtn = new ButtonBuilder().setCustomId(`reject_${interaction.user.id}_${clanIndex}`).setLabel('رفض').setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder().addComponents(acceptBtn, rejectBtn);

            await resultsChannel.send({ embeds: [resultEmbed], components: [row] });
        }
    }
    // معالجة أزرار القبول والرفض من قائد الكلان
    if (interaction.isButton() && (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('reject_'))) {
        const parts = interaction.customId.split('_');
        const action = parts[0];
        const applicantId = parts[1];
        const clanIndex = parseInt(parts[2]);

        const clan = await Clan.findOne({ clanIndex });
        if (!clan) return interaction.reply({ content: 'الكلان غير متوفر بقاعدة البيانات.', ephemeral: true });

        // التحقق من الهوية (هل هو قائد الكلان المحدد؟)
        if (interaction.user.id !== clan.leaderId) {
            return interaction.reply({ content: 'أنت لست قائد هذا الكلان لاتخاذ هذا الإجراء.', ephemeral: true });
        }

        const applicant = await interaction.guild.members.fetch(applicantId).catch(() => null);

        if (action === 'accept') {
            if (applicant && clan.roleId) await applicant.roles.add(clan.roleId).catch(() => {});
            if (applicant) await applicant.send({ content: `تهانينا، لقد تم قبول طلب انضمامك لكلان: ${clan.clanName}` }).catch(() => {});
            await interaction.reply({ content: `تم قبول العضو بنجاح.` });
        } else {
            if (applicant) await applicant.send({ content: `نعتذر منك، لقد تم رفض طلب انضمامك لكلان: ${clan.clanName}` }).catch(() => {});
            await interaction.reply({ content: `تم رفض العضو.` });
        }
        await interaction.message.delete().catch(() => {});
    }

    // معالجة منيو قائمة التحكم الخاصة بالقائد
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('leader_menu_')) {
        const clanIndex = parseInt(interaction.customId.replace('leader_menu_', ''));
        const clan = await Clan.findOne({ clanIndex });
        if (!clan || interaction.user.id !== clan.leaderId) {
            return interaction.reply({ content: 'غير مسموح لك باستخدام هذه القائمة.', ephemeral: true });
        }

        const selection = interaction.values[0];
        await interaction.deferReply({ ephemeral: true });

        if (selection === 'info') {
            return interaction.editReply({ content: `معلومات الكلان:\nالاسم: ${clan.clanName}\nالنقاط الإجمالية: ${clan.totalPoints} ${clan.pointsName}` });
        }
        
        if (selection === 'add_member' || selection === 'remove_member' || selection === 'check_member') {
            await interaction.editReply({ content: 'من فضلك قم بكتابة الرقم التعريفي الخاص بالعضو المطلوب في الشات خلال 30 ثانية.' });
            const filter = m => m.author.id === interaction.user.id;
            const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 30000 }).catch(() => null);
            if (!collected) return interaction.followUp({ content: 'انتهى الوقت ولم يتم إدخال معرف العضو.', ephemeral: true });
            
            const targetId = collected.first().content;
            const member = await interaction.guild.members.fetch(targetId).catch(() => null);

            if (selection === 'add_member') {
                if (member && clan.roleId) await member.roles.add(clan.roleId).catch(() => {});
                return interaction.followUp({ content: `تم إضافة العضو بنجاح وتعيين رتبة الكلان له.`, ephemeral: true });
            }
            if (selection === 'remove_member') {
                if (member && clan.roleId) await member.roles.remove(clan.roleId).catch(() => {});
                return interaction.followUp({ content: `تم طرد العضو وسحب الرتبة منه بنجاح.`, ephemeral: true });
            }
            if (selection === 'check_member') {
                const currentPts = clan.membersPoints.get(targetId) || 0;
                return interaction.followUp({ content: `نقاط العضو الحالية هي: ${currentPts} ${clan.pointsName}`, ephemeral: true });
            }
        }

        if (selection === 'total_points') {
            return interaction.editReply({ content: `نقاط الكلان الكاملة المتراكمة: ${clan.totalPoints} ${clan.pointsName}` });
        }
    }
});

// نظام النقاط التلقائي وأمر تحكم القائد لقنوات الكتابة
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // تفعيل أمر "تحكم" لقائد الكلان
    if (message.content === 'تحكم') {
        const clan = await Clan.findOne({ textChannelId: message.channel.id });
        if (clan && message.author.id === clan.leaderId) {
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`leader_menu_${clan.clanIndex}`)
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

    // احتساب نقاط تفاعل الشات (15 نقطة لكل 20 رسالة)
    const activeClan = await Clan.findOne({ textChannelId: message.channel.id });
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

// احتساب نقاط الرومات الصوتية (30 نقطة لكل 20 دقيقة متواصلة)
const voiceTimers = new Map();

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.member.user.bot) return;

    // دخول العضو روم صوتي مخصص لكلان
    if (!oldState.channelId && newState.channelId) {
        const clan = await Clan.findOne({ voiceChannelId: newState.channelId });
        if (clan) {
            const timer = setInterval(async () => {
                const updatedClan = await Clan.findOne({ voiceChannelId: newState.channelId });
                if (updatedClan) {
                    let userPoints = updatedClan.membersPoints.get(newState.member.id) || 0;
                    updatedClan.membersPoints.set(newState.member.id, userPoints + 30);
                    updatedClan.totalPoints += 30;
                    await updatedClan.save();
                }
            }, 20 * 60 * 1000); // 20 دقيقة متواصلة
            
            voiceTimers.set(newState.member.id, timer);
        }
    }

    // خروج العضو من الروم الصوتي أو التبديل لقناة أخرى
    if (oldState.channelId && !newState.channelId) {
        const timer = voiceTimers.get(oldState.member.id);
        if (timer) {
            clearInterval(timer);
            voiceTimers.delete(oldState.member.id);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`الداشبورد يعمل بشكل مباشر على المنفذ: ${PORT}`));
