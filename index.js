const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// --- 1. الاتصال بقاعدة البيانات MongoDB ---
const mongoURI = process.env.MONGO_URI || 'mongodb+srv://hsamhmaydh4_db_user:Hosamhosamhosam@cluster0.wjnh8d0.mongodb.net/justice_db?retryWrites=true&w=majority';
mongoose.connect(mongoURI)
    .then(() => console.log('✅ تم الاتصال بنجاح بقاعدة البيانات MongoDB'))
    .catch(err => console.error('❌ فشل الاتصال بقاعدة البيانات:', err));

// تعريف مخطط حفظ البيانات لكل سيرفر بشكل مستقل
const GuildConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    embedTitle: { type: String, default: 'أهلاً بك في السيرفر! 🎉' },
    embedDescription: { type: String, default: 'نورتنا يا {user}، أنت العضو رقم {members} في مجتمعنا! 💖\nدعاه: {inviter}' },
    avatarX: { type: Number, default: 150 },
    avatarY: { type: Number, default: 150 },
    avatarSize: { type: Number, default: 120 },
    textX: { type: Number, default: 300 },
    textY: { type: Number, default: 220 },
    welcomeMessage: { type: String, default: 'العضو الجديد في السيرفر هو {user} واللذي دعاه هو {inviter}' },
    backgroundImage: { type: String, default: 'https://imgur.com' },
    welcomeChannelId: { type: String, default: '' }
});
const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);

// --- 2. إعداد سيرفر الويب والـ Sessions ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'super_secret_welcome_bot_key_2026',
    resave: false,
    saveUninitialized: false
}));

// إعدادات الـ OAuth2 من ديسكورد
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'https://onrender.com';

// صفحة الدخول الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});
// مسار تسجيل الدخول (يُعيد توجيه المستخدم لموقع ديسكورد)

app.get('/login', (req, res) => {
    const discordLoginUrl =
        `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;

    res.redirect(discordLoginUrl);
});

// مسار الـ Callback بعد موافقة المستخدم في ديسكورد
app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/');

    try {
        // تبديل الـ Code بـ Access Token
        const tokenResponse = await axios.post('https://discord.com', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenResponse.data.access_token;

        // جلب بيانات حساب المستخدم
        const userResponse = await axios.get('https://discord.com', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // جلب قائمة سيرفرات المستخدم
        const guildsResponse = await axios.get('https://discord.com/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // حفظ البيانات في الجلسة (Session)
        req.session.user = userResponse.data;
        
        // تصفية السيرفرات: نأخذ فقط السيرفرات التي يملك فيها المستخدم صلاحية Administrator (0x8) والمتواجد فيها البوت
        req.session.guilds = guildsResponse.data.filter(g => {
            const isAdmin = (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8);
            const isBotInGuild = client.guilds.cache.has(g.id);
            return isAdmin && isBotInGuild;
        });

        res.redirect('/dashboard');
    } catch (error) {
        console.error('خطأ في الـ Callback الخاص بالـ OAuth2:', error?.response?.data || error.message);
        res.send('حدث خطأ أثناء تسجيل الدخول، تأكد من إعداد الـ CLIENT_ID والـ CLIENT_SECRET بشكل صحيح على Render.');
    }
});

// عرض لوحة التحكم بعد تسجيل الدخول الناجح
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// جلب السيرفرات المتاحة للمستخدم وبيانات حسابه
app.get('/api/user-data', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مسجل دخول' });
    res.json({ user: req.session.user, guilds: req.session.guilds || [] });
});

// جلب إعدادات سيرفر معين وقائمة روماته الكتابية
app.get('/api/guild-config/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مسجل دخول' });
    const { guildId } = req.params;

    // التأكد أن المستخدم أدمن في هذا السيرفر المحدد
    const hasAccess = req.session.guilds.some(g => g.id === guildId);
    if (!hasAccess) return res.status(403).json({ error: 'لا تملك صلاحيات لهذا السيرفر' });

    let dbConfig = await GuildConfig.findOne({ guildId });
    if (!dbConfig) {
        dbConfig = await GuildConfig.create({ guildId });
    }

    // جلب رومات السيرفر الكتابية
    const guild = client.guilds.cache.get(guildId);
    let channels = [];
    if (guild) {
        channels = guild.channels.cache
            .filter(ch => ch.type === 0)
            .map(ch => ({ id: ch.id, name: ch.name }));
    }

    res.json({ config: dbConfig, channels });
});

// حفظ إعدادات السيرفر المختار
app.post('/api/guild-config/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مسجل دخول' });
    const { guildId } = req.params;

    const hasAccess = req.session.guilds.some(g => g.id === guildId);
    if (!hasAccess) return res.status(403).json({ error: 'لا تملك صلاحية تعديل هذا السيرفر' });

    await GuildConfig.findOneAndUpdate({ guildId }, req.body, { upsert: true });
    res.json({ success: true, message: 'تم حفظ إعدادات السيرفر بنجاح في قاعدة البيانات! ✅' });
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
// --- 3. إعداد وكود بوت الديسكورد وتتبع الدعوات ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildInvites
    ]
});

const invitesCache = new Map();

client.once('ready', async () => {
    console.log(`🤖 بوت الترحيب الخارق المطور جاهز وشغال كـ: ${client.user.tag}`);
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const invites = await guild.invites.fetch();
            invitesCache.set(guild.id, new Map(invites.map(inv => [inv.code, inv.uses])));
        } catch (err) {
            console.log(`صلاحيات جلب الدعوات ناقصة في سيرفر: ${guild.name}`);
        }
    }
});

client.on('inviteCreate', async (invite) => {
    const guildInvites = invitesCache.get(invite.guild.id) || new Map();
    guildInvites.set(invite.code, invite.uses);
    invitesCache.set(invite.guild.id, guildInvites);
});

client.on('inviteDelete', (invite) => {
    const guildInvites = invitesCache.get(invite.guild.id);
    if (guildInvites) guildInvites.delete(invite.code);
});

client.on('guildMemberAdd', async (member) => {
    // جلب إعدادات السيرفر الحالي من MongoDB
    let dbConfig = await GuildConfig.findOne({ guildId: member.guild.id });
    if (!dbConfig) dbConfig = new GuildConfig({ guildId: member.guild.id });

    let welcomeChannel = member.guild.channels.cache.get(dbConfig.welcomeChannelId);
    if (!welcomeChannel) {
        welcomeChannel = member.guild.channels.cache.find(ch => ch.name.includes('ترحيب') || ch.name.includes('welcome')) || member.guild.systemChannel;
    }
    if (!welcomeChannel) return;

    try {
        let inviterName = 'غير معروف';
        try {
            const newInvites = await member.guild.invites.fetch();
            const oldInvites = invitesCache.get(member.guild.id);
            const usedInvite = newInvites.find(inv => oldInvites && oldInvites.get(inv.code) < inv.uses);
            if (usedInvite && usedInvite.inviter) {
                inviterName = `<@${usedInvite.inviter.id}>`;
            }
            invitesCache.set(member.guild.id, new Map(newInvites.map(inv => [inv.code, inv.uses])));
        } catch (err) {
            console.error('خطأ تتبع الدعوة:', err.message);
        }

        const memberCount = member.guild.memberCount;
        const replaceVars = (text) => {
            return text
                .replace(/{user}/g, `<@${member.id}>`)
                .replace(/{username}/g, member.user.username)
                .replace(/{server}/g, member.guild.name)
                .replace(/{members}/g, memberCount)
                .replace(/{inviter}/g, inviterName); 
        };

        const parsedTitle = replaceVars(dbConfig.embedTitle);
        const parsedDescription = replaceVars(dbConfig.embedDescription);
        const parsedContent = replaceVars(dbConfig.welcomeMessage);

        // إنشاء صورة الـ Canvas بناءً على إعدادات السيرفر المخزنة
        const canvas = createCanvas(800, 400);
        const ctx = canvas.getContext('2d');
        const background = await loadImage(dbConfig.backgroundImage);
        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.beginPath();
        const radius = dbConfig.avatarSize / 2;
        const centerX = Number(dbConfig.avatarX) + radius;
        const centerY = Number(dbConfig.avatarY) + radius;
        
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();

        const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatar = await loadImage(avatarURL);
        ctx.drawImage(avatar, dbConfig.avatarX, dbConfig.avatarY, dbConfig.avatarSize, dbConfig.avatarSize);
        ctx.restore();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText(`Welcome, ${member.user.username}!`, dbConfig.textX, dbConfig.textY);

        const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'welcome-image.png' });

        const welcomeEmbed = new EmbedBuilder()
            .setTitle(parsedTitle)
            .setDescription(parsedDescription)
            .setImage('attachment://welcome-image.png')
            .setColor('#7289da')
            .setTimestamp();

        await welcomeChannel.send({
            content: parsedContent,
            embeds: [welcomeEmbed],
            files: [attachment]
        });

    } catch (error) {
        console.error('حدث خطأ ترحيب بالسيرفر:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
