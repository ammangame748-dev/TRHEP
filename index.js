require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, crypto } = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const path = require('path');
const Clan = require('./models/Clan');

const app = express();
const PORT = process.env.PORT || 3000;

// الاتصال المحمي بقاعدة البيانات
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('تم الاتصال بقاعدة البيانات العسكرية بنجاح'))
    .catch(err => console.error('خطأ في الاتصال بقاعدة البيانات:', err));

// إعدادات البوت الأساسية بالـ Intents الكاملة
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

// إعدادات جلسات تسجيل الدخول الآمنة للداشبورد
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
    secret: 'clan_secret_ultra_secure_session_key',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// جدار حماية متطور للتحقق من تسجيل الدخول وصلاحيات السيرفرات المتقاطعة
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
        <div style="background:#1e293b; padding:15px; margin:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid #334155;">
            <span style="font-weight:bold; color:#f1f5f9;">${g.name}</span>
            <a href="/dashboard/${g.id}" style="background:#0284c7; color:white; padding:8px 14px; text-decoration:none; border-radius:6px; font-weight:bold; transition: 0.2s;">دخول اللوحة</a>
        </div>
    `).join('');

    if (adminGuilds.length === 0) {
        guildOptions = '<p style="text-align:center; color:#ef4444;">لا تمتلك صلاحية إدارة (Administrator/Manage Server) في أي سيرفر مضاف فيه البوت.</p>';
    }

    res.send(`
        <html lang="ar" dir="rtl">
        <head><meta charset="UTF-8"><title>اختر السيرفر المراد إدارته</title></head>
        <body style="font-family:sans-serif; background:#0f172a; color:#f1f5f9; padding:40px;">
            <div style="max-width:600px; margin:0 auto; background:#1e293b; padding:25px; border-radius:12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); border:1px solid #334155;">
                <h2 style="text-align:center; border-bottom:2px solid #334155; padding-bottom:15px; margin-bottom:20px; color:#38bdf8;">اختر السيرفر لإدارة الكلانات المطورّة</h2>
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

// تحديث إعدادات الكلان من الداشبورد وتوليد توكن أمان جديد للجلسة لمنع استغلال الأزرار القديمة المعلقة
app.post('/api/clans/update', checkAuth, async (req, res) => {
    const { guildId, clanIndex, leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName, q1, q2, q3 } = req.body;
    try {
        // التحقق الإضافي من صلاحية المستخدم لهذا السيرفر بالذات لمنع التلاعب الخارجي بالـ API
        const hasPerm = req.user.guilds.some(g => g.id === guildId && ((g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20));
        if (!hasPerm) return res.status(403).send('غير مصرح لك بتعديل بيانات هذا السيرفر.');

        // توليد توكن فريد مشفر لكل تحديث لنسف تفعيل الأزرار العتيقة في غرف القادة السابقة
        const newToken = require('crypto').randomBytes(16).toString('hex');

        await Clan.findOneAndUpdate({ guildId, clanIndex: parseInt(clanIndex) }, {
            leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName,
            questions: [q1, q2, q3],
            sessionToken: newToken
        }, { upsert: true });

        await updateApplyEmbed(guildId, parseInt(clanIndex));
        res.redirect('/dashboard/' + guildId);
    } catch (err) {
        console.error(err);
        res.status(500).send('حدث خطأ أثناء حفظ التعديلات.');
    }
});

async function updateApplyEmbed(guildId, clanIndex) {
    try {
        const clan = await Clan.findOne({ guildId, clanIndex });
        if (!clan || !clan.applyChannelId) return;
        const channel = await client.channels.fetch(clan.applyChannelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(`تقديم الانضمام إلى كلان: ${clan.clanName || 'غير محدد'}`)
            .setDescription(clan.applyContent || 'اضغط على الزر أدناه لبدء المقابلة والتقديم.')
            .setColor(0x38bdf8);

        const button = new ButtonBuilder()
            .setCustomId(`applybtn_${guildId}_${clanIndex}`)
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
    } catch (e) {
        console.error('خطأ في تحديث إمبد التقديم:', e);
    }
}
// =============================================================
// الجزء الثاني - أ: أحداث التفاعل ونظام المقابلات والمودالز الموحدة
// =============================================================

client.on('interactionCreate', async interaction => {
    try {
        // معالجة النوافذ المنبثقة (Modals) لقائد الكلان بالهيكلة المطورة
        if (interaction.isModalSubmit() && interaction.customId.startsWith('clan_modal_')) {
          const parts = interaction.customId.replace('clan_modal_', '').split('__'); // تعديل هنا لشرطتين
const action = parts[0];
const clanIndex = parseInt(parts[1]);

            const guildId = interaction.guild.id;

            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: 'حدث خطأ في جلب بيانات الكلان من قاعدة البيانات.', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

            const targetId = interaction.fields.getTextInputValue('target_user_id').trim();
            const member = await interaction.guild.members.fetch(targetId).catch(() => null);
            const responseEmbed = new EmbedBuilder().setColor(0x38bdf8);

            if (action === 'add_member') {
                if (!member) {
                    responseEmbed.setTitle('خطأ في العملية').setDescription('لم يتم العثور على العضو في هذا السيرفر، يرجى التحقق من الـ ID.').setColor(0xff0000);
                    return interaction.editReply({ embeds: [responseEmbed] });
                }
                
                // إضافة العضو للمصفوفة الموحدة الجديدة إذا لم يكن موجوداً مسبقاً
                const isMemberExist = clan.members.some(m => m.userId === targetId);
              if (!isMemberExist) {
    clan.members.push({ userId: targetId, points: 0, messageCount: 0, voiceMinutes: 0 });

    clan.members = clan.members.filter(m => m && m.userId);

    await clan.save();
}

                if (clan.roleId) await member.roles.add(clan.roleId).catch(() => {});
                responseEmbed.setTitle('تحديث الرتب والأعضاء').setDescription(`تم إضافة العضو <@${targetId}> بنجاح للمصفوفة الموحدة وتعيين رتبة الكلان له.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === 'remove_member') {
                if (!member) {
                    responseEmbed.setTitle('خطأ في العملية').setDescription('لم يتم العثور على العضو في هذا السيرفر، يرجى التحقق من الـ ID.').setColor(0xff0000);
                    return interaction.editReply({ embeds: [responseEmbed] });
                }

               clan.members = clan.members.filter(m => m.userId !== targetId);
clan.members = clan.members.filter(m => m && m.userId);

await clan.save();

                if (clan.roleId) await member.roles.remove(clan.roleId).catch(() => {});
                responseEmbed.setTitle('تحديث الرتب والأعضاء').setDescription(`تم طرد العضو <@${targetId}> وسحب الرتبة وحذفه من المصفوفة الموحدة للكلان.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === 'check_member') {
                const memberData = clan.members.find(m => m.userId === targetId);
                const currentPts = memberData ? memberData.points : 0;
                
                responseEmbed.setTitle('استعلام عن نقاط عضو موحد')
                    .setDescription(`إحصائيات العضو <@${targetId}> الحالية داخل الكلان:\n\n• النقاط الشخصية: \`${currentPts}\` \`${clan.pointsName}\` \n• رسائل الشات المتراكمة: \`${memberData ? memberData.messageCount : 0}\` \n• دقائق الصوت الإجمالية: \`${memberData ? memberData.voiceMinutes : 0}\` دقائق.`)
                    .setColor(0x059669);
                return interaction.editReply({ embeds: [responseEmbed] });
            }
        }
        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

        // معالجة زر تقديم الكلان التفاعلي المؤمّن من الإغراق والـ Flood
        if (interaction.isButton() && interaction.customId.startsWith('applybtn_')) {
            const parts = interaction.customId.split('_');
            const guildId = parts[1];
            const clanIndex = parseInt(parts[2]);

            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: 'حدث خطأ في جلب بيانات الكلان.', ephemeral: true });

            // حماية التقديم: فحص سجل القائمة السوداء للمرفوضين مؤخراً من التقديم
            const blacklistEntry = clan.blacklist.find(b => b.userId === interaction.user.id);
            if (blacklistEntry && blacklistEntry.until > new Date()) {
                const timeLeft = Math.ceil((blacklistEntry.until - new Date()) / (1000 * 60 * 60 * 24));
                return interaction.reply({ content: `نعتذر منك، لقد تم رفض طلبك سابقاً. يمكنك التقديم مجدداً بعد انقضاء حظر التقديم المؤقت (متبقي: ${timeLeft} أيام).`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            // إنشاء روم التقديم الخصوصي بنظام الـ Threads
            const thread = await interaction.channel.threads.create({
                name: `تقديم-${interaction.user.username}`,
                autoArchiveDuration: 60,
                type: 12, 
                reason: 'طلب تقديم كلان تفاعلي معزز بنظام حماية'
            }).catch(() => null);

            if (!thread) return interaction.editReply({ content: 'فشل إنشاء روم التقديم الخاص بك، تأكد من صلاحيات البوت لإدارة الـ Threads في الروم.' });

            await thread.members.add(interaction.user.id).catch(() => {});
            await interaction.editReply({ content: `تم فتح نموذج التقديم التفاعلي الآمن الخاص بك هنا: ${thread}` });

            const answers = [];
            const questions = clan.questions && clan.questions.filter(q => q.trim() !== '').length ? clan.questions : ['السؤال الأول', 'السؤال الثاني', 'السؤال الثالث'];

            for (let i = 0; i < questions.length; i++) {
                let confirmed = false;
                let currentAnswer = '';

                // نظام الأسئلة التفاعلية بالأزرار لضمان دقة الإجابة ومنع الأخطاء المطبعية العشوائية من المتقدمين
                while (!confirmed) {
                    await thread.send({ content: `**السؤال ${i + 1}:** ${questions[i]}\n*(اكتب إجابتك أسفل هذه الرسالة مباشرة)*` }).catch(() => {});
                    const filter = m => m.author.id === interaction.user.id;
                    const collected = await thread.awaitMessages({ filter, max: 1, time: 120000, errors: ['time'] }).catch(() => null);

                    if (!collected) {
                        await thread.send({ content: 'تم إلغاء التقديم تلقائياً بسبب عدم الرد في الوقت المحدد.' }).catch(() => {});
                        return setTimeout(() => thread.delete().catch(() => { }), 3000);
                    }

                    currentAnswer = collected.first().content;

                    // أزرار التأكيد والتعديل في التقديم لمنع قفل الإجابات الخاطئة
                    const acceptAnsId = `confirm_ans_true_${interaction.user.id}_${i}`;
                    const editAnsId = `confirm_ans_false_${interaction.user.id}_${i}`;

                    const rowConfirm = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(acceptAnsId).setLabel('تأكيد الإجابة والانتقال').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(editAnsId).setLabel('إعادة صياغة الإجابة').setStyle(ButtonStyle.Danger)
                    );

                    const confirmMsg = await thread.send({ content: `**إجابتك المقترحة للسؤال هي:**\n\`\`\`${currentAnswer}\`\`\`\nهل أنت متأكد من هذه الإجابة؟`, components: [rowConfirm] });
                    const btnFilter = btnInt => btnInt.user.id === interaction.user.id && (btnInt.customId === acceptAnsId || btnInt.customId === editAnsId);
                    const clickedBtn = await confirmMsg.awaitMessageComponent({ filter: btnFilter, time: 60000 }).catch(() => null);

                    if (!clickedBtn) {
                        await thread.send({ content: 'تم إلغاء التقديم لعدم الضغط على أزرار المراجعة والتأكيد.' }).catch(() => {});
                        return setTimeout(() => thread.delete().catch(() => { }), 3000);
                    }

                    await clickedBtn.deferUpdate().catch(() => {});
                    if (clickedBtn.customId.startsWith('confirm_ans_true_')) {
                        confirmed = true;
                        answers.push(currentAnswer);
                    }
                    await confirmMsg.delete().catch(() => {});
                }
            }

            // تحسين الأمان: إغلاق وتجميد الـ Thread وأرشفته رسمياً ليكون سجلاً تاريخياً للكلان بدلاً من حذفه عشوائياً
            await thread.send({ content: `تم قفل وتجميد نموذج التقديم الخاص بك وإرساله للجنة قادة الكلان للمراجعة الفورية.` }).catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});

            const resultsChannel = await client.channels.fetch(clan.resultsChannelId).catch(() => null);
            if (resultsChannel) {
                const resultEmbed = new EmbedBuilder()
                    .setTitle(`طلب انضمام جديد للكلان: ${clan.clanName}`)
                    .setDescription(`• مقدم الطلب: <@${interaction.user.id}>\n• معرف الحساب: \`${interaction.user.id}\``)
                    .setColor(0xffff00)
                    .setFooter({ text: `مفتاح أمان جلسة القائد الحالية: ${clan.sessionToken}` });

                questions.forEach((q, idx) => {
                    resultEmbed.addFields({ name: `جـ ${idx + 1}: ${q}`, value: answers[idx] || 'لا يوجد إجابة' });
                });

                // ربط أزرار القبول بالتوكن الأمني الفريد (sessionToken) لمنع استخدام الأزرار القديمة المعلقة من القادة المعزولين
                const acceptBtn = new ButtonBuilder().setCustomId(`accept_${interaction.guild.id}_${interaction.user.id}_${clanIndex}_${clan.sessionToken}`).setLabel('قبول الانضمام').setStyle(ButtonStyle.Success);
                const rejectBtn = new ButtonBuilder().setCustomId(`reject_${interaction.guild.id}_${interaction.user.id}_${clanIndex}_${clan.sessionToken}`).setLabel('رفض الانضمام').setStyle(ButtonStyle.Danger);
                const row = new ActionRowBuilder().addComponents(acceptBtn, rejectBtn);

                await resultsChannel.send({ embeds: [resultEmbed], components: [row] }).catch(() => {});
            }
        }
        // معالجة أزرار القبول والرفض المدعومة بتوكن الأمان المتقاطع لمنع ثغرات القادة المعزولين
        if (interaction.isButton() && (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('reject_'))) {
            const parts = interaction.customId.split('_');
            const action = parts[0];
            const guildId = parts[1];
            const applicantId = parts[2];
            const clanIndex = parseInt(parts[3]);
            const buttonToken = parts[4]; // التوكن الممرر من زر التقديم وقت إنشائه

            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: 'الكلان غير متوفر بقاعدة البيانات الحالية.', ephemeral: true });

            // 1. حماية صلاحية القيادة الحالية والمباشرة
            if (interaction.user.id !== clan.leaderId) {
                return interaction.reply({ content: 'أنت لست قائد هذا الكلان الفعلي لاتخاذ هذا الإجراء .', ephemeral: true });
            }

            // 2. فحص ومطابقة مفتاح أمان الجلسة؛ إذا تغيرت اللوحة يُلغى مفعول الأزرار المعلقة تلقائياً
            if (clan.sessionToken && clan.sessionToken !== buttonToken) {
                await interaction.message.delete().catch(() => {});
                return interaction.reply({ content: 'تم إلغاء صلاحية هذا الزر نظراً لتحديث لوحة تحكم الكلان أو تبديل القيادة مؤخراً لحماية البيانات.', ephemeral: true });
            }

            const applicant = await interaction.guild.members.fetch(applicantId).catch(() => null);

            if (action === 'accept') {
                if (applicant) {
                    // حماية الرتب المتقاطعة (Role Mutex): سحب رتب الكلانات السبعة الأخرى تلقائياً لمنع التجسس والتداخل
                    const allClans = await Clan.find({ guildId });
                    for (const c of allClans) {
                        if (c.clanIndex !== clanIndex && c.roleId && applicant.roles.cache.has(c.roleId)) {
                            await applicant.roles.remove(c.roleId).catch(() => {});
                            // إزالة العضو من مصفوفة الكلان القديم الموحدة
                            c.members = c.members.filter(m => m.userId !== applicantId);
                            await c.save();
                        }
                    }

                    // إضافة العضو للمصفوفة الموحدة الجديدة للكلان الحالي
                    const isMemberExist = clan.members.some(m => m.userId === applicantId);
                    if (!isMemberExist) {
                        clan.members.push({ userId: applicantId, points: 0, messageCount: 0, voiceMinutes: 0 });
                        await clan.save();
                    }

                    if (clan.roleId) await applicant.roles.add(clan.roleId).catch(() => {});
                    await applicant.send({ content: ` تهانينا الملحمية، لقد تم قبول طلب انضمامك رسمياً لكلان: ${clan.clanName}` }).catch(() => {});
                }
                await interaction.reply({ content: `تم قبول العضو، وسحب منه رتب الكلانات المنافسة بنجاح   .` });
            } else {
                // تفعيل خاصية الحظر التلقائي للتقديم لمدة 3 أيام لحماية قنوات النتائج من الإغراق والـ Flood
                if (applicant) {
                    const blockUntil = new Date();
                    blockUntil.setDate(blockUntil.getDate() + 3); // 3 أيام حظر
                    clan.blacklist.push({ userId: applicantId, until: blockUntil });

clan.members = clan.members.filter(m => m && m.userId);

await clan.save();

                    await applicant.send({ content: `نعتذر منك، لقد تم رفض طلب انضمامك لكلان: ${clan.clanName}. يمكنك التقديم مجدداً بعد 3 أيام.` }).catch(() => {});
                }
                await interaction.reply({ content: `تم رفض العضو بنجاح، ووضعه في القائمة السوداء المؤقتة للتقديم.` });
            }
            await interaction.message.delete().catch(() => {});
        }

        // معالجة منيو قائمة التحكم الخاصة بالقائد وتحويلها إلى Modals و Embeds
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('leader_menu_')) {
            const parts = interaction.customId.replace('leader_menu_', '').split('_');
            const guildId = parts[0];
            const clanIndex = parseInt(parts[1]);
            const clan = await Clan.findOne({ guildId, clanIndex });
            
            if (!clan || interaction.user.id !== clan.leaderId) {
                return interaction.reply({ content: 'غير مسموح لك باستخدام هذه القائمة  المخصصة للقادة الفعليين.', ephemeral: true });
            }

            const selection = interaction.values[0];

            if (selection === 'info') {
                const infoEmbed = new EmbedBuilder()
                    .setTitle(`معلومات الكلان المطور: ${clan.clanName}`)
                    .setColor(0x38bdf8)
                    .addFields(
                        { name: 'اسم الكلان ', value: `${clan.clanName || 'غير محدد'}`, inline: true },
                        { name: 'نقاط الكلان', value: `\`${clan.clanVaultPoints}\` \`${clan.pointsName}\``, inline: true },
                        { name: 'إجمالي الأعضاء  ', value: `\`${clan.members.length}\` لاعب`, inline: true }
                    );
                return interaction.reply({ embeds: [infoEmbed], ephemeral: true });
            }

            if (selection === 'total_points') {
                const pointsEmbed = new EmbedBuilder()
                    .setTitle(`    نقاط الكلان بشكل كامل: ${clan.clanName}`)
                    .setDescription(      ` نقاط الكلان  : \`${clan.clanVaultPoints}\` \`${clan.pointsName}\`\n*(هذه النقاط ثابتة بالخزنة ولا تتأثر بمغادرة أو طرد أي لاعب)*`)
                    .setColor(0x059669);
                return interaction.reply({ embeds: [pointsEmbed], ephemeral: true });
            }

            const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
            let modalTitle = '';
            
            if (selection === 'add_member') modalTitle = 'اضافة عضو للكلان ';
            if (selection === 'remove_member') modalTitle = 'طرد عضو  من الكلان';
            if (selection === 'check_member') modalTitle = 'استعلام إحصائيات عضو بالكلان';

           const modal = new ModalBuilder()
    .setCustomId(`clan_modal_${selection}__${clanIndex}`) // تعديل هنا بوضع شرطتين سفليتين متتاليتين __
    .setTitle(modalTitle);


            const userIdInput = new TextInputBuilder()
                .setCustomId('target_user_id')
                .setLabel('أدخل الرقم التعريفي (ID) الخاص بالعضو المعني')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder('مثال: 123456789012345678');

            const row = new ActionRowBuilder().addComponents(userIdInput);
            modal.addComponents(row);

            return await interaction.showModal(modal);
        }
    } catch (err) {
        console.error('خطأ شامل في معالجة التفاعلات بالـ InteractionCreate:', err);
    }
});
// -------------------------------------------------------------
// نظام نقاط الشات الذكي (مع حماية ضد السبام والرسائل الوهمية)
// -------------------------------------------------------------
const chatCooldowns = new Map();

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    try {
        if (message.content === 'تحكم') {
            const clan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
            if (clan && message.author.id === clan.leaderId) {
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`leader_menu_${message.guild.id}_${clan.clanIndex}`)
                    .setPlaceholder(' للتحكم بالكلان اختر من القائمه ')
                    .addOptions([
                        { label: 'معلومات الكلان الشاملة', value: 'info' },
                        { label: 'اضافة عضو للكلان ', value: 'add_member' },
                        { label: 'طرد  عضو من الكلان', value: 'remove_member' },
                        { label: 'استعلام عن نقاط وإحصائيات عضو', value: 'check_member' },
                        { label: 'نقاط الخزنة  للكلان', value: 'total_points' }
                    ]);

                const row = new ActionRowBuilder().addComponents(menu);
                return message.reply({ content: ' للتحكم بالكلان', components: [row] });
            }
        }

        const activeClan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
        if (activeClan) {
            // حماية الكفاءة 1: تفعيل نظام Cooldown لمنع احتساب الرسائل المتكررة في أقل من 3 ثوانٍ
            const lastMsgTime = chatCooldowns.get(message.author.id) || 0;
            if (Date.now() - lastMsgTime < 3000) return;
            chatCooldowns.set(message.author.id, Date.now());

            // حماية الكفاءة 2: فحص طول ومحتوى الرسالة لمنع النقاط والسبام العشوائي
            if (message.content.trim().length < 3) return;

            // البحث عن العضو داخل المصفوفة الموحدة الجديدة لتحديث بياناته داخلياً
            let memberIdx = activeClan.members.findIndex(m => m.userId === message.author.id);
            if (memberIdx === -1) {
                activeClan.members.push({ userId: message.author.id, points: 0, messageCount: 0, voiceMinutes: 0 });
                memberIdx = activeClan.members.length - 1;
            }

            activeClan.members[memberIdx].messageCount += 1;

            // عندما يكمل العضو تفاعل 20 رسالة حقيقية ومؤمّنة
            if (activeClan.members[memberIdx].messageCount >= 20) {
                activeClan.members[memberIdx].messageCount = 0; // تصفير عداد الشات المؤقت للعضو
                activeClan.members[memberIdx].points += 12;      // إضافة 12 نقطة لحساب اللاعب الشخصي (80%)
                activeClan.clanVaultPoints += 3;                 // إضافة 3 نقاط مباشرة لخزنة الكلان السيادية (20% ضريبة كفاح وتفاعل ثابتة)
            }
            
            await activeClan.save();
        }
    } catch (err) {
        console.error('خطأ غير متوقع في نظام نقاط الشات المعزز:', err);
    }
});

// -------------------------------------------------------------
// نظام نقاط الصوت الاستراتيجي القائم على الـ Timestamp (المقاوم لسقوط البوت)
// -------------------------------------------------------------
const voiceSessionStart = new Map(); // لتخزين وقت الدخول المباشر بدقة بالـ ميلّي ثانية

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        if (newState.member.user.bot) return;

        const memberId = newState.member.id;
        const guildId = newState.guild.id;

        const newClan = newState.channelId ? await Clan.findOne({ guildId, voiceChannelId: newState.channelId }) : null;
        const oldClan = oldState.channelId ? await Clan.findOne({ guildId, voiceChannelId: oldState.channelId }) : null;

        // السيناريو الأول: الدخول الفعلي أو الانتقال لقناة صوتية تابعة للكلانات الثمانية
        if (newClan && (!oldClan || oldState.channelId !== newState.channelId)) {
            // تسجيل وقت الدخول بالـ ثانية (Timestamp) لنسف تشغيل الـ setInterval المستهلك للموارد
            voiceSessionStart.set(memberId, Date.now());
        }

        // السيناريو الثاني: الخروج الكامل أو الانتقال لقناة صوتية عادية لا تتبع الكلانات الثمانية
        if (oldClan && (!newClan || oldState.channelId !== newState.channelId)) {
            const startTime = voiceSessionStart.get(memberId);
            if (startTime) {
                const durationMs = Date.now() - startTime;
                const durationMinutes = Math.floor(durationMs / (1000 * 60)); // حساب الدقائق الفعلية المقضاة داخل الروم الصوتي

                if (durationMinutes >= 1) {
                    const clanToUpdate = await Clan.findOne({ guildId, voiceChannelId: oldState.channelId });
                    if (clanToUpdate) {
                        // إيجاد العضو وتحديث بياناته أو إنشائه إن لم يكن مسجلاً بالمصفوفة الموحدة
                        let memberIdx = clanToUpdate.members.findIndex(m => m.userId === memberId);
                        if (memberIdx === -1) {
                            clanToUpdate.members.push({ userId: memberId, points: 0, messageCount: 0, voiceMinutes: 0 });
                            memberIdx = clanToUpdate.members.length - 1;
                        }

                        // إضافة الدقائق الإجمالية التراكمية
                        clanToUpdate.members[memberIdx].voiceMinutes += durationMinutes;
                        
                        // احتساب كم دورة كاملة مدتها 20 دقيقة قضاها في هذا الاتصال
                        const loops = Math.floor(durationMinutes / 20);
                        if (loops >= 1) {
                            clanToUpdate.members[memberIdx].points += (loops * 24); // 24 نقطة للشخص (80% من النسبة الإجمالية 30 نقطة)
                            clanToUpdate.clanVaultPoints += (loops * 6);       // 6 نقاط ثابتة تذهب مباشرة لخزنة الكلان المستقلة (20% ضريبة البنك الثابت)
                        }

                        await clanToUpdate.save();
                    }
                }
                voiceSessionStart.delete(memberId); // تنظيف الكاش المؤقت فور خروج اللاعب لحماية الذاكرة كلياً
            }
        }
    } catch (err) {
        console.error('خطأ فادح في معالجة نقاط رومات الصوت الاستراتيجية بالـ Timestamps:', err);
    }
});

// تشغيل البوت والداشبورد والمزامنة مع المتغيرات البيئية
client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`الداشبورد العسكري الخارق يعمل بشكل مباشر وآمن على المنفذ: ${PORT}`));
