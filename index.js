const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// --- 1. إعداد وكود بوت الديسكورد وتتبع الدعوات ---
// تم نقل تعريف الـ client للأعلى لتجنب خطأ الـ ReferenceError في مسارات الويب
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildInvites
    ]
});

const invitesCache = new Map();

// --- 2. الاتصال بقاعدة البيانات MongoDB ---
const mongoURI = process.env.MONGO_URI || 'mongodb+srv://hsamhmaydh4_db_user:Hosamhosamhosam@cluster0.wjnh8d0.mongodb.net/justice_db?retryWrites=true&w=majority';
mongoose.connect(mongoURI)
    .then(() => console.log('✅ تم الاتصال بنجاح بقاعدة البيانات MongoDB'))
    .catch(err => console.error('❌ فشل الاتصال بقاعدة البيانات:', err));

// تعريف مخطط حفظ البيانات (تم تصحيح رابط الصورة الافتراضي لصورة حقيقية)
const GuildConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    embedTitle: { type: String, default: 'أهلاً بك في السيرفر! 🎉' },
    embedDescription: { type: String, default: 'نورتنا يا {user}، أنت العضو رقم {members} في مجتمعنا! 💖\nدعاه: {inviter}' },
    avatarX: { type: Number, default: 150 },
    avatarY: { type: Number, default: 150 },
    avatarSize: { type: Number, default: 120 },
    textX: { type: Number, default: 300 },
    textY: { type: Number, default: 220 },
    welcomeMessage: { type: String, default: 'العضو الجديد في السيرفر هو {user} والذي دعاه هو {inviter}' },
    backgroundImage: { type: String, default: 'https://imgur.com' }, // رابط صورة مباشر صالح
    welcomeChannelId: { type: String, default: '' }
});
const GuildConfig = mongoose.model('GuildConfig', GuildConfigSchema);

// --- 3. إعداد سيرفر الويب والـ Sessions ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'super_secret_welcome_bot_key_2026',
    resave: false,
    saveUninitialized: false
}));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = 'https://trhep.onrender.com/callback';

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/login', (req, res) => {
    const discordLoginUrl =
`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordLoginUrl);
});
app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/');

    try {
        // تصحيح الرابط إلى مسار الـ API المخصص للتوكن
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenResponse.data.access_token;

const userResponse = await axios.get(
    'https://discord.com/api/users/@me',
    {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    }
);

        // تصحيح مسار جلب السيرفرات
        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds',{
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        req.session.user = userResponse.data;
        
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

app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/api/user-data', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مسجل دخول' });
    res.json({ user: req.session.user, guilds: req.session.guilds || [] });
});

app.get('/api/guild-config/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مسجل دخول' });
    const { guildId } = req.params;

    const hasAccess = req.session.guilds.some(g => g.id === guildId);
    if (!hasAccess) return res.status(403).json({ error: 'لا تملك صلاحيات لهذا السيرفر' });

    let dbConfig = await GuildConfig.findOne({ guildId });
    if (!dbConfig) {
        dbConfig = await GuildConfig.create({ guildId });
    }

    const guild = client.guilds.cache.get(guildId);
    let channels = [];
    if (guild) {
        channels = guild.channels.cache
            .filter(ch => ch.type === 0)
            .map(ch => ({ id: ch.id, name: ch.name }));
    }

    res.json({ config: dbConfig, channels });
});

app.post('/api/guild-config/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مسجل دخول' });
    const { guildId } = req.params;

    const hasAccess = req.session.guilds.some(g => g.id === guildId);
    if (!hasAccess) return res.status(403).json({ error: 'لا تملك صلاحية تعديل هذا السيرفر' });

    await GuildConfig.findOneAndUpdate({ guildId }, req.body, { upsert: true });
    res.json({ success: true, message: 'تم حفظ إعدادات السيرفر بنجاح في قاعدة البيانات! ✅' });
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

// --- 4. أحداث البوت (Bot Events) ---
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
    try {
        let dbConfig = await GuildConfig.findOne({ guildId: member.guild.id });
        if (!dbConfig) dbConfig = new GuildConfig({ guildId: member.guild.id });

        let welcomeChannel = member.guild.channels.cache.get(dbConfig.welcomeChannelId);
        if (!welcomeChannel) {
            welcomeChannel = member.guild.channels.cache.find(ch => ch.name.includes('ترحيب') || ch.name.includes('welcome')) || member.guild.systemChannel;
        }
        if (!welcomeChannel) return;

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

// 1. تحديث دالة استبدال المتغيرات لدعم الشرح (Prompt)
const replaceVars = (text) => {
    if (!text) return '';
    
    // هنا نأخذ الشرح من قاعدة البيانات، وإذا كان فارغاً نضع وصفاً افتراضياً بالإنجليزية ليفهمه الذكاء الاصطناعي
    const imagePrompt = dbConfig.welcomeMessage ? encodeURIComponent(dbConfig.welcomeMessage) : 'cyberpunk+neon+welcome+background';

    return text
        .replace(/{user}/g, `<@${member.id}>`)
        .replace(/{username}/g, member.user.username)
        .replace(/{server}/g, member.guild.name)
        .replace(/{members}/g, memberCount)
        .replace(/{inviter}/g, inviterName)
        .replace(/{prompt}/g, imagePrompt); // استبدال الكلمة المفتاحية بالوصف المشفر للرابط
};

          // 1. معالجة المتغيرات النصية العادية للـ Embed
        const parsedTitle = replaceVars(dbConfig.embedTitle);
        const parsedDescription = replaceVars(dbConfig.embedDescription);
        const parsedContent = replaceVars(dbConfig.welcomeMessage);

        // 2. توليد رقم عشوائي فريد لكل عضو يدخل السيرفر
        const randomSeed = Math.floor(Math.random() * 999999) + 1;

        // 3. تنظيف الشرح وجلبه بأمان
        let rawPrompt = dbConfig.backgroundImage || 'futuristic+gaming+neon+background';
        
        // إذا كانت الخانة تحتوي على رابط قديم مشوه، نقوم بتنظيفها وأخذ الكلمات المفتاحية المفيدة فقط
        if (rawPrompt.includes('http')) {
            rawPrompt = 'futuristic+gaming+neon+background'; 
        }
        
        const cleanPrompt = encodeURIComponent(rawPrompt);

        const finalBackgroundImageUrl = `https://pollinations.ai/p/${cleanPrompt}?width=800&height=400&seed=${randomSeed}`;


        // إنشاء صورة Canvas
        const canvas = createCanvas(800, 400);
        const ctx = canvas.getContext('2d');
        
        // 5. جلب الخلفية الديناميكية
        try {
            console.log(`⏳ جاري طلب التوليد من الرابط الصحيح: ${finalBackgroundImageUrl}`);
            const background = await loadImage(finalBackgroundImageUrl);
            ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        } catch (imgError) {
            console.error('❌ فشل توليد الصورة بسبب:', imgError.message);
            ctx.fillStyle = '#1e1f22'; // خلفية بديلة في حال حدوث ضغط على موقع التوليد
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }



        // رسم صورة العضو بشكل دائري كلياً
        ctx.save();
        ctx.beginPath();
        const radius = Number(dbConfig.avatarSize) / 2;
        const centerX = Number(dbConfig.avatarX) + radius;
        const centerY = Number(dbConfig.avatarY) + radius;
        
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();

        try {
            const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
            const avatar = await loadImage(avatarURL);
            ctx.drawImage(avatar, Number(dbConfig.avatarX), Number(dbConfig.avatarY), Number(dbConfig.avatarSize), Number(dbConfig.avatarSize));
        } catch (avError) {
            console.error('فشل جلب صورة أفاتار العضو:', avError.message);
        }
        ctx.restore();

        // طباعة نص الترحيب على الصورة بشكل ديناميكي
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText(`Welcome, ${member.user.username}!`, Number(dbConfig.textX), Number(dbConfig.textY));

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
