require('dotenv').config();
const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, 
    TextInputBuilder, TextInputStyle, ChannelType 
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const Clan = require('./models/Clan');

const app = express();
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('تم الاتصال بقاعدة البيانات بنجاح'))
    .catch(err => console.error('خطأ في الاتصال بقاعدة البيانات:', err));

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
    secret: 'clan_secret_secure_key',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', passport.authenticate('discord'));
app.get('/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/dashboard');
});

app.get('/dashboard', checkAuth, (req, res) => {
    const adminGuilds = req.user.guilds.filter(guild => (guild.permissions & 0x8) === 0x8 || (guild.permissions & 0x20) === 0x20);

    let guildOptions = adminGuilds.map(g => `
        <div style="background:#1e293b; padding:15px; margin:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; border:1px solid #334155;">
            <span style="font-weight:bold; color:#f1f5f9;">${g.name}</span>
            <a href="/dashboard/${g.id}" style="background:#0284c7; color:white; padding:8px 14px; text-decoration:none; border-radius:6px; font-weight:bold; transition: 0.2s;">دخول اللوحة</a>
        </div>
    `).join('');

    if (adminGuilds.length === 0) {
        guildOptions = '<p style="text-align:center; color:#ef4444;">لا تمتلك صلاحية إدارة في أي سيرفر مضاف فيه البوت.</p>';
    }

    res.send(`
        <html lang="ar" dir="rtl">
        <head><meta charset="UTF-8"><title>اختر السيرفر</title></head>
        <body style="font-family:sans-serif; background:#0f172a; color:#f1f5f9; padding:40px;">
            <div style="max-width:600px; margin:0 auto; background:#1e293b; padding:25px; border-radius:12px; border:1px solid #334155;">
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
    if (!hasPerm) return res.status(403).send('غير مسموح لك بالوصول.');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/api/guild-meta/:guildId', checkAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'السيرفر غير موجود' });

    const roles = guild.roles.cache.filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name }));
    const channels = guild.channels.cache;
    const textChannels = channels.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name }));
    const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).map(c => ({ id: c.id, name: c.name }));

    res.json({ roles, textChannels, voiceChannels });
});

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
        res.status(500).send('خطأ في جلب البيانات');
    }
});

app.post('/api/clans/update', checkAuth, async (req, res) => {
    const { guildId, clanIndex, leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, resultsChannelId, applyContent, pointsName, q1, q2, q3 } = req.body;
    try {
        const hasPerm = req.user.guilds.some(g => g.id === guildId && ((g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20));
        if (!hasPerm) return res.status(403).send('غير مصرح لك.');

        const newToken = crypto.randomBytes(16).toString('hex');
        await Clan.findOneAndUpdate({ guildId, clanIndex: parseInt(clanIndex) }, {
            leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, resultsChannelId, applyContent, pointsName,
            questions: [q1, q2, q3],
            sessionToken: newToken
        }, { upsert: true });

        await updateApplyEmbed(guildId, parseInt(clanIndex));
        res.redirect('/dashboard/' + guildId);
    } catch (err) {
        res.status(500).send('خطأ في الحفظ');
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
            .setDescription(clan.applyContent || 'اضغط على الزر أدناه للتقديم.')
            .setColor(0x38bdf8);

        const button = new ButtonBuilder()
            .setCustomId(`applybtn_${guildId}_${clanIndex}`)
            .setLabel('تقديم طلب انضمام')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);
        const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
        const botMsg = messages?.find(m => m.author.id === client.user.id);

        if (botMsg) await botMsg.edit({ embeds: [embed], components: [row] }).catch(() => { });
        else await channel.send({ embeds: [embed], components: [row] }).catch(() => { });
    } catch (e) {
        console.error('خطأ في تحديث إمبد التقديم:', e);
    }
}

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isModalSubmit() && interaction.customId.startsWith('clan_modal_')) {
            const parts = interaction.customId.replace('clan_modal_', '').split('__');
            const action = parts[0];
            const clanIndex = parseInt(parts[1]);
            const guildId = interaction.guild.id;

            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: 'الكلان غير موجود.', ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const targetId = interaction.fields.getTextInputValue('target_user_id').trim();
            const member = await interaction.guild.members.fetch(targetId).catch(() => null);
            const responseEmbed = new EmbedBuilder().setColor(0x38bdf8);

            if (action === 'add_member') {
                if (!member) return interaction.editReply({ content: 'العضو غير موجود.' });
                if (!clan.members.some(m => m.userId === targetId)) {
                    clan.members.push({ userId: targetId, points: 0, messageCount: 0, voiceMinutes: 0 });
                    await clan.save();
                }
                if (clan.roleId) await member.roles.add(clan.roleId).catch(() => {});
                responseEmbed.setTitle('تمت الإضافة').setDescription(`تم إضافة <@${targetId}> للكلان.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === 'remove_member') {
                clan.members = clan.members.filter(m => m.userId !== targetId);
                await clan.save();
                if (member && clan.roleId) await member.roles.remove(clan.roleId).catch(() => {});
                responseEmbed.setTitle('تم الطرد').setDescription(`تم طرد <@${targetId}> من الكلان.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === 'check_member') {
                const data = clan.members.find(m => m.userId === targetId);
                responseEmbed.setTitle('إحصائيات العضو')
                    .setDescription(`العضو: <@${targetId}>\nالنقاط: \`${data ? data.points : 0}\` \`${clan.pointsName}\`\nالرسائل: \`${data ? data.messageCount : 0}\`\nدقائق الصوت: \`${data ? data.voiceMinutes : 0}\``);
                return interaction.editReply({ embeds: [responseEmbed] });
            }
        }

        if (interaction.isButton() && interaction.customId.startsWith('applybtn_')) {
            const parts = interaction.customId.split('_');
            const guildId = parts[1];
            const clanIndex = parseInt(parts[2]);
            const clan = await Clan.findOne({ guildId, clanIndex });

            const blacklistEntry = clan.blacklist.find(b => b.userId === interaction.user.id);
            if (blacklistEntry && blacklistEntry.until > new Date()) {
                return interaction.reply({ content: 'أنت محظور من التقديم حالياً.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const thread = await interaction.channel.threads.create({
                name: `تقديم-${interaction.user.username}`,
                autoArchiveDuration: 60,
                type: ChannelType.PrivateThread,
                reason: 'طلب تقديم'
            }).catch(() => null);

            if (!thread) return interaction.editReply({ content: 'فشل إنشاء الروم.' });
            await thread.members.add(interaction.user.id).catch(() => {});
            await interaction.editReply({ content: `تم فتح روم التقديم: ${thread}` });

            const questions = clan.questions?.filter(q => q.trim() !== '') || ['السؤال 1', 'السؤال 2', 'السؤال 3'];
            const answers = [];

            for (let i = 0; i < questions.length; i++) {
                await thread.send({ content: `**السؤال ${i + 1}:** ${questions[i]}` });
                const collected = await thread.awaitMessages({ filter: m => m.author.id === interaction.user.id, max: 1, time: 60000 }).catch(() => null);
                if (!collected) {
                    await thread.send({ content: 'انتهى الوقت.' });
                    return setTimeout(() => thread.delete().catch(() => {}), 3000);
                }
                answers.push(collected.first().content);
            }

            await thread.send({ content: 'تم إرسال طلبك.' });
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});

            const resultsChannel = await client.channels.fetch(clan.resultsChannelId).catch(() => null);
            if (resultsChannel) {
                const embed = new EmbedBuilder().setTitle(`طلب انضمام: ${clan.clanName}`).setDescription(`المقدم: <@${interaction.user.id}>`).setColor(0xffff00);
                questions.forEach((q, idx) => embed.addFields({ name: q, value: answers[idx] }));
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`accept_${guildId}_${interaction.user.id}_${clanIndex}_${clan.sessionToken}`).setLabel('قبول').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`reject_${guildId}_${interaction.user.id}_${clanIndex}_${clan.sessionToken}`).setLabel('رفض').setStyle(ButtonStyle.Danger)
                );
                await resultsChannel.send({ embeds: [embed], components: [row] });
            }
        }

        if (interaction.isButton() && (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('reject_'))) {
            const [action, guildId, applicantId, clanIndex, token] = interaction.customId.split('_');
            const clan = await Clan.findOne({ guildId, clanIndex: parseInt(clanIndex) });

            if (interaction.user.id !== clan.leaderId) return interaction.reply({ content: 'لست القائد.', ephemeral: true });
            if (clan.sessionToken !== token) return interaction.reply({ content: 'الزر منتهي الصلاحية.', ephemeral: true });

            const applicant = await interaction.guild.members.fetch(applicantId).catch(() => null);
            if (action === 'accept') {
                const allClans = await Clan.find({ guildId });
                for (const c of allClans) {
                    if (c.clanIndex !== parseInt(clanIndex) && c.roleId && applicant?.roles.cache.has(c.roleId)) {
                        await applicant.roles.remove(c.roleId).catch(() => {});
                        c.members = c.members.filter(m => m.userId !== applicantId);
                        await c.save();
                    }
                }
                if (!clan.members.some(m => m.userId === applicantId)) {
                    clan.members.push({ userId: applicantId, points: 0, messageCount: 0, voiceMinutes: 0 });
                    await clan.save();
                }
                if (clan.roleId && applicant) await applicant.roles.add(clan.roleId).catch(() => {});
                await interaction.reply({ content: 'تم القبول.' });
            } else {
                const until = new Date(); until.setDate(until.getDate() + 3);
                clan.blacklist.push({ userId: applicantId, until });
                await clan.save();
                await interaction.reply({ content: 'تم الرفض.' });
            }
            await interaction.message.delete().catch(() => {});
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('leader_menu_')) {
            const [_, __, guildId, clanIndex] = interaction.customId.split('_');
            const clan = await Clan.findOne({ guildId, clanIndex: parseInt(clanIndex) });
            if (interaction.user.id !== clan.leaderId) return interaction.reply({ content: 'لست القائد.', ephemeral: true });

            const selection = interaction.values[0];
            if (selection === 'info') {
                const embed = new EmbedBuilder().setTitle(`معلومات: ${clan.clanName}`).addFields(
                    { name: 'النقاط', value: `${clan.clanVaultPoints}`, inline: true },
                    { name: 'الأعضاء', value: `${clan.members.length}`, inline: true }
                ).setColor(0x38bdf8);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (selection === 'total_points') {
                return interaction.reply({ content: `نقاط الخزنة: ${clan.clanVaultPoints}`, ephemeral: true });
            }

            const modal = new ModalBuilder().setCustomId(`clan_modal_${selection}__${clanIndex}`).setTitle('تحكم العضو');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target_user_id').setLabel('ID العضو').setStyle(TextInputStyle.Short).setRequired(true)
            ));
            await interaction.showModal(modal);
        }
    } catch (err) { console.error(err); }
});

const chatCooldowns = new Map();
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (message.content === 'تحكم') {
        const clan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
        if (clan && message.author.id === clan.leaderId) {
            const menu = new StringSelectMenuBuilder().setCustomId(`leader_menu_${message.guild.id}_${clan.clanIndex}`).setPlaceholder('قائمة التحكم')
                .addOptions([
                    { label: 'معلومات الكلان', value: 'info' },
                    { label: 'إضافة عضو', value: 'add_member' },
                    { label: 'طرد عضو', value: 'remove_member' },
                    { label: 'إحصائيات عضو', value: 'check_member' },
                    { label: 'نقاط الخزنة', value: 'total_points' }
                ]);
            return message.reply({ content: 'قائمة التحكم بالكلان:', components: [new ActionRowBuilder().addComponents(menu)] });
        }
    }

    const activeClan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
    if (activeClan) {
        const last = chatCooldowns.get(message.author.id) || 0;
        if (Date.now() - last < 3000 || message.content.length < 3) return;
        chatCooldowns.set(message.author.id, Date.now());

        let mIdx = activeClan.members.findIndex(m => m.userId === message.author.id);
        if (mIdx === -1) {
            activeClan.members.push({ userId: message.author.id, points: 0, messageCount: 0, voiceMinutes: 0 });
            mIdx = activeClan.members.length - 1;
        }
        activeClan.members[mIdx].messageCount++;
        if (activeClan.members[mIdx].messageCount >= 20) {
            activeClan.members[mIdx].messageCount = 0;
            activeClan.members[mIdx].points += 12;
            activeClan.clanVaultPoints += 3;
        }
        await activeClan.save();
    }
});

const voiceStart = new Map();
client.on('voiceStateUpdate', async (oldS, newS) => {
    const mId = newS.member.id;
    const gId = newS.guild.id;
    if (newS.channelId && !oldS.channelId) voiceStart.set(mId, Date.now());
    else if (!newS.channelId && oldS.channelId) {
        const start = voiceStart.get(mId);
        if (start) {
            const mins = Math.floor((Date.now() - start) / 60000);
            if (mins >= 1) {
                const clan = await Clan.findOne({ guildId: gId, voiceChannelId: oldS.channelId });
                if (clan) {
                    let mIdx = clan.members.findIndex(m => m.userId === mId);
                    if (mIdx === -1) {
                        clan.members.push({ userId: mId, points: 0, messageCount: 0, voiceMinutes: 0 });
                        mIdx = clan.members.length - 1;
                    }
                    clan.members[mIdx].voiceMinutes += mins;
                    const loops = Math.floor(mins / 20);
                    if (loops >= 1) {
                        clan.members[mIdx].points += (loops * 24);
                        clan.clanVaultPoints += (loops * 6);
                    }
                    await clan.save();
                }
            }
            voiceStart.delete(mId);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`الداشبورد يعمل على المنفذ: ${PORT}`));
