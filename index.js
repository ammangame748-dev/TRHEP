require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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
    .then(() => console.log('✅ تم الاتصال بقاعدة البيانات بنجاح'))
    .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err));

// إعدادات البوت
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

// إعدادات جلسات تسجيل الدخول
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
    secret: process.env.SESSION_SECRET || 'clan_secret_ultra_secure_session_key',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// جدار حماية للتحقق من تسجيل الدخول
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
        guildOptions = '<p style="text-align:center; color:#ef4444;">لا تمتلك صلاحية إدارة في أي سيرفر.</p>';
    }

    res.send(`
        <html lang="ar" dir="rtl">
        <head><meta charset="UTF-8"><title>اختر السيرفر</title></head>
        <body style="font-family:sans-serif; background:#0f172a; color:#f1f5f9; padding:40px;">
            <div style="max-width:600px; margin:0 auto; background:#1e293b; padding:25px; border-radius:12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); border:1px solid #334155;">
                <h2 style="text-align:center; border-bottom:2px solid #334155; padding-bottom:15px; margin-bottom:20px; color:#38bdf8;">اختر السيرفر لإدارة الكلانات</h2>
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

// جلب بيانات الكلانات
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

// جلب قنوات السيرفر
app.get('/api/guild/:guildId/channels', checkAuth, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const guild = await client.guilds.fetch(guildId);
        
        const textChannels = guild.channels.cache.filter(c => c.isTextBased()).map(c => ({ id: c.id, name: c.name }));
        const voiceChannels = guild.channels.cache.filter(c => c.isVoiceBased()).map(c => ({ id: c.id, name: c.name }));
        
        res.json({ textChannels, voiceChannels });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب القنوات' });
    }
});

// جلب الرتب
app.get('/api/guild/:guildId/roles', checkAuth, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        const guild = await client.guilds.fetch(guildId);
        
        const roles = guild.roles.cache
            .filter(r => !r.managed && r.id !== guildId)
            .map(r => ({ id: r.id, name: r.name }));
        
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب الرتب' });
    }
});

// تحديث إعدادات الكلان
app.post('/api/clans/update', checkAuth, async (req, res) => {
    const { guildId, clanIndex, leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName, q1, q2, q3 } = req.body;
    try {
        const hasPerm = req.user.guilds.some(g => g.id === guildId && ((g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20));
        if (!hasPerm) return res.status(403).send('غير مصرح لك بتعديل بيانات هذا السيرفر.');

        const parsedClanIndex = parseInt(clanIndex, 10);
        if (isNaN(parsedClanIndex)) {
            return res.status(400).send('خطأ: معرف الكلان يجب أن يكون رقماً صالحاً.');
        }

        const newToken = require('crypto').randomBytes(16).toString('hex');

        await Clan.findOneAndUpdate({ guildId, clanIndex: parsedClanIndex }, {
            leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, interviewChannelId, resultsChannelId, applyContent, pointsName,
            questions: [q1, q2, q3],
            sessionToken: newToken
        }, { upsert: true });

        await updateApplyEmbed(guildId, parsedClanIndex);
        res.json({ success: true, message: 'تم حفظ التعديلات بنجاح' });
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
// نظام التفاعلات والمقابلات
// =============================================================

const chatCooldowns = new Map();

client.on('interactionCreate', async interaction => {
    try {
        // معالجة النوافذ المنبثقة (Modals)
        if (interaction.isModalSubmit() && interaction.customId.startsWith('clan_modal_')) {
            const parts = interaction.customId.replace('clan_modal_', '').split('__');
            const action = parts[0];
            const clanIndex = parseInt(parts[1]);

            const guildId = interaction.guild.id;

            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: 'حدث خطأ في جلب بيانات الكلان.', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

            const targetId = interaction.fields.getTextInputValue('target_user_id').trim();
            const member = await interaction.guild.members.fetch(targetId).catch(() => null);
            const responseEmbed = new EmbedBuilder().setColor(0x38bdf8);

            if (action === 'add_member') {
                if (!member) {
                    responseEmbed.setTitle('❌ خطأ').setDescription('لم يتم العثور على العضو في هذا السيرفر.').setColor(0xff0000);
                    return interaction.editReply({ embeds: [responseEmbed] });
                }
                
                const isMemberExist = clan.members.some(m => m.userId === targetId);
                if (!isMemberExist) {
                    clan.members.push({ userId: targetId, points: 0, messageCount: 0, voiceMinutes: 0 });
                    clan.members = clan.members.filter(m => m && m.userId);
                    await clan.save();
                }

                if (clan.roleId) await member.roles.add(clan.roleId).catch(() => {});
                responseEmbed.setTitle('✅ تم الإضافة').setDescription(`تم إضافة العضو <@${targetId}> بنجاح للكلان.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === 'remove_member') {
                if (!member) {
                    responseEmbed.setTitle('❌ خطأ').setDescription('لم يتم العثور على العضو.').setColor(0xff0000);
                    return interaction.editReply({ embeds: [responseEmbed] });
                }

                clan.members = clan.members.filter(m => m.userId !== targetId);
                clan.members = clan.members.filter(m => m && m.userId);
                await clan.save();

                if (clan.roleId) await member.roles.remove(clan.roleId).catch(() => {});
                responseEmbed.setTitle('✅ تم الطرد').setDescription(`تم طرد العضو <@${targetId}> من الكلان.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === 'check_member') {
                const memberData = clan.members.find(m => m.userId === targetId);
                const currentPts = memberData ? memberData.points : 0;
                
                responseEmbed.setTitle('📊 إحصائيات العضو')
                    .setDescription(`**العضو:** <@${targetId}>\n\n• **النقاط:** \`${currentPts}\` ${clan.pointsName}\n• **الرسائل:** \`${memberData ? memberData.messageCount : 0}\`\n• **دقائق الصوت:** \`${memberData ? memberData.voiceMinutes : 0}\` دقائق`)
                    .setColor(0x059669);
                return interaction.editReply({ embeds: [responseEmbed] });
            }
        }

        if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

        // معالجة زر التقديم
        if (interaction.isButton() && interaction.customId.startsWith('applybtn_')) {
            const parts = interaction.customId.split('_');
            const guildId = parts[1];
            const clanIndex = parseInt(parts[2]);

            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: 'حدث خطأ في جلب بيانات الكلان.', ephemeral: true });

            const blacklistEntry = clan.blacklist.find(b => b.userId === interaction.user.id);
            if (blacklistEntry && blacklistEntry.until > new Date()) {
                const timeLeft = Math.ceil((blacklistEntry.until - new Date()) / (1000 * 60 * 60 * 24));
                return interaction.reply({ content: `أنت محظور من التقديم. متبقي: ${timeLeft} أيام.`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const thread = await interaction.channel.threads.create({
                name: `تقديم-${interaction.user.username}`,
                autoArchiveDuration: 60
            });

            const modal = new ModalBuilder()
                .setCustomId(`clan_modal_add_member__${clanIndex}`)
                .setTitle('تقديم الانضمام للكلان');

            const input = new TextInputBuilder()
                .setCustomId('target_user_id')
                .setLabel('معرف المستخدم')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));

            await thread.send({ content: `مرحباً <@${interaction.user.id}>! سيتم معالجة طلبك قريباً.` });
            await interaction.editReply({ content: `تم إنشاء روم التقديم: ${thread}` });
        }
    } catch (err) {
        console.error('خطأ في معالجة التفاعل:', err);
    }
});

// نظام نقاط الشات
client.on('messageCreate', async message => {
    try {
        if (message.author.bot) return;

        const activeClan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
        if (activeClan) {
            const lastMsgTime = chatCooldowns.get(message.author.id) || 0;
            if (Date.now() - lastMsgTime < 3000) return;
            chatCooldowns.set(message.author.id, Date.now());

            if (message.content.trim().length < 3) return;

            let memberIdx = activeClan.members.findIndex(m => m.userId === message.author.id);
            if (memberIdx === -1) {
                activeClan.members.push({ userId: message.author.id, points: 0, messageCount: 0, voiceMinutes: 0 });
                memberIdx = activeClan.members.length - 1;
            }

            activeClan.members[memberIdx].messageCount += 1;

            if (activeClan.members[memberIdx].messageCount >= 20) {
                activeClan.members[memberIdx].messageCount = 0;
                activeClan.members[memberIdx].points += 12;
                activeClan.clanVaultPoints += 3;
            }
            
            await activeClan.save();
        }
    } catch (err) {
        console.error('خطأ في نظام نقاط الشات:', err);
    }
});

// نظام نقاط الصوت
const voiceSessionStart = new Map();

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        if (newState.member.user.bot) return;

        const memberId = newState.member.id;
        const guildId = newState.guild.id;

        const newClan = newState.channelId ? await Clan.findOne({ guildId, voiceChannelId: newState.channelId }) : null;
        const oldClan = oldState.channelId ? await Clan.findOne({ guildId, voiceChannelId: oldState.channelId }) : null;

        if (newClan && (!oldClan || oldState.channelId !== newState.channelId)) {
            voiceSessionStart.set(memberId, Date.now());
        }

        if (oldClan && (!newClan || oldState.channelId !== newState.channelId)) {
            const startTime = voiceSessionStart.get(memberId);
            if (startTime) {
                const durationMs = Date.now() - startTime;
                const durationMinutes = Math.floor(durationMs / (1000 * 60));

                if (durationMinutes >= 1) {
                    const clanToUpdate = await Clan.findOne({ guildId, voiceChannelId: oldState.channelId });
                    if (clanToUpdate) {
                        let memberIdx = clanToUpdate.members.findIndex(m => m.userId === memberId);
                        if (memberIdx === -1) {
                            clanToUpdate.members.push({ userId: memberId, points: 0, messageCount: 0, voiceMinutes: 0 });
                            memberIdx = clanToUpdate.members.length - 1;
                        }

                        clanToUpdate.members[memberIdx].voiceMinutes += durationMinutes;
                        
                        const loops = Math.floor(durationMinutes / 20);
                        if (loops >= 1) {
                            clanToUpdate.members[memberIdx].points += (loops * 24);
                            clanToUpdate.clanVaultPoints += (loops * 6);
                        }

                        await clanToUpdate.save();
                    }
                }
                voiceSessionStart.delete(memberId);
            }
        }
    } catch (err) {
        console.error('خطأ في نظام نقاط الصوت:', err);
    }
});

// تشغيل البوت والداشبورد
client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`✅ الداشبورد يعمل على المنفذ: ${PORT}`));
