const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const express = require('express');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// --- إعدادات البوت والداش بورد الحالية (مخزنة في الذاكرة) ---
let config = {
    embedTitle: 'أهلاً بك في السيرفر! 🎉',
    embedDescription: 'نورتنا يا {user}، أنت العضو رقم {members} في مجتمعنا! 💖',
    avatarX: 150, // مكان صورة العضو الأفقي
    avatarY: 150, // مكان صورة العضو العمودي
    avatarSize: 120, // حجم دائرة صورة العضو
    textX: 300, // مكان النص الأفقي داخل الصورة
    textY: 220, // مكان النص العمودي داخل الصورة
    welcomeMessage: 'العضو الجديد في السيرفر هو {user}',
    backgroundImage: 'https://imgur.com' // خلفية افتراضية في حال لم يتم توليد خلفية AI
};

// --- إعداد سيرفر الويب (Express) للـ Dashboard ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// عرض صفحة الداش بورد
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// إرسال الإعدادات الحالية للداش بورد عند فتحها
app.get('/api/config', (req, res) => {
    res.json(config);
});

// استقبال التعديلات الجديدة من الداش بورد وحفظها
app.post('/api/config', (req, res) => {
    config = { ...config, ...req.body };
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح! ✅' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


// --- إعداد بوت الديسكورد ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ]
});

client.once('ready', () => {
    console.log(`🤖 بوت الترحيب جاهز وشغال باسم: ${client.user.tag}`);
});

// حدث دخول عضو جديد للسيرفر
client.on('guildMemberAdd', async (member) => {
    // تحديد روم الترحيب (تأكد من تعديل الـ ID أو البحث عن روم باسم معين)
    const welcomeChannel = member.guild.channels.cache.find(ch => ch.name.includes('ترحيب') || ch.name.includes('welcome')) || member.guild.systemChannel;
    if (!welcomeChannel) return;

    try {
        // 1. معالجة النصوص الجاهزة واستبدال المتغيرات
        const memberCount = member.guild.memberCount;
        const replaceVars = (text) => {
            return text
                .replace(/{user}/g, `<@${member.id}>`)
                .replace(/{username}/g, member.user.username)
                .replace(/{server}/g, member.guild.name)
                .replace(/{members}/g, memberCount);
        };

        const parsedTitle = replaceVars(config.embedTitle);
        const parsedDescription = replaceVars(config.embedDescription);
        const parsedContent = replaceVars(config.welcomeMessage);

        // 2. صناعة صورة الترحيب باستخدام Canvas بناءً على إحداثيات الداش بورد
        const canvas = createCanvas(800, 400); // حجم لوحة الرسم
        const ctx = canvas.getContext('2d');

        // تحميل الخلفية (التي تم اختيارها أو توليدها)
        const background = await loadImage(config.backgroundImage);
        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

        // رسم صورة العضو الدائرية
        ctx.save();
        ctx.beginPath();
        // الإحداثيات والحجم يتم جلبهم من الداش بورد مباشرة
        const radius = config.avatarSize / 2;
        const centerX = Number(config.avatarX) + radius;
        const centerY = Number(config.avatarY) + radius;
        
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();

        const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
        const avatar = await loadImage(avatarURL);
        ctx.drawImage(avatar, config.avatarX, config.avatarY, config.avatarSize, config.avatarSize);
        ctx.restore();

        // كتابة نص داخل الصورة حسب إحداثيات الداش بورد
        ctx.fillStyle = '#ffffff'; // لون الخط أبيض
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText(`Welcome, ${member.user.username}!`, config.textX, config.textY);

        // تحويل الرسمة إلى ملف مرفق للديسكورد
        const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'welcome-image.png' });

        // 3. بناء الـ Embed وإرساله
        const welcomeEmbed = new EmbedBuilder()
            .setTitle(parsedTitle)
            .setDescription(parsedDescription)
            .setImage('attachment://welcome-image.png')
            .setColor('#5865F2')
            .setTimestamp();

        // إرسال الرسالة الكاملة مع المنشن والإمبيد والصورة
        await welcomeChannel.send({
            content: parsedContent,
            embeds: [welcomeEmbed],
            files: [attachment]
        });

    } catch (error) {
        console.error('حدث خطأ أثناء إرسال رسالة الترحيب:', error);
    }
});

// ضع توكن البوت الخاص بك في متغيرات بيئة Render باسم DISCORD_TOKEN
client.login(process.env.DISCORD_TOKEN);
