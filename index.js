require("dotenv").config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require("discord.js");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 10000;

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("تم الاتصال بقاعدة البيانات بنجاح"))
    .catch(err => console.error("خطأ في الاتصال بقاعدة البيانات:", err));

// Discord Client Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

// Passport Session Setup
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Discord Strategy for Passport
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.REDIRECT_URI,
    scope: ["identify", "guilds"],
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

// Express Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || "change-this-to-a-long-random-secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        httpOnly: true
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// Helper function for permission checking
function hasAdminPermissions(guildPermissions) {
    return (guildPermissions & 0x8) === 0x8 || (guildPermissions & 0x20) === 0x20;
}

// Middleware to check authentication
function checkAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect("/login");
}

// Routes
app.get("/", (req, res) => {
    if (req.isAuthenticated()) return res.redirect("/dashboard");
    res.redirect("/login");
});
app.get("/login", passport.authenticate("discord"));
app.get("/callback", passport.authenticate("discord", { failureRedirect: "/" }), (req, res) => {
    res.redirect("/dashboard");
});

// دالة تقرأ ملف HTML وترجعه كـ string
function readView(filename) {
    return fs.readFileSync(path.join(__dirname, "views", filename), "utf-8");
}

// دالة لحقن بيانات السيرفرات في HTML
function injectGuildData(html, guildId = null) {
    const adminGuilds = [];
    if (typeof global.__cachedAdminGuilds__ !== 'undefined' && guildId === null) {
        // For main dashboard, use cached guilds
        return html.replace(
            "<!-- GUILD_DATA -->",
            `<script>window.__adminGuilds__ = ${JSON.stringify(global.__cachedAdminGuilds__)};</script>`
        );
    }

    // Always fetch fresh guilds from session
    return html;
}

app.get("/dashboard", checkAuth, (req, res) => {
    const adminGuilds = req.user.guilds.filter(guild => hasAdminPermissions(guild.permissions));
    // حفظ السيرفرات في متغير عام للاستخدام
    req.session.adminGuilds = adminGuilds;
    // نعرض الداشبورد مباشرة مع إرسال بيانات السيرفرات
    let html = readView("dashboard.html");
    html = html.replace(
        "<!-- GUILD_DATA -->",
        `<script>window.__adminGuilds__ = ${JSON.stringify(adminGuilds)};</script>`
    );
    res.send(html);
});

app.get("/dashboard/:guildId", checkAuth, async (req, res) => {
    const guildId = req.params.guildId;
    const hasPerm = req.user.guilds.some(g => g.id === guildId && hasAdminPermissions(g.permissions));
    if (!hasPerm) return res.status(403).send("غير مسموح لك بالوصول.");

    const adminGuilds = req.user.guilds.filter(guild => hasAdminPermissions(guild.permissions));
    let html = readView("dashboard.html");
    // نوصل guildId و adminGuilds للـ HTML
    html = html.replace(
        "<!-- GUILD_DATA -->",
        `<script>window.__guildId__ = "${guildId}"; window.__adminGuilds__ = ${JSON.stringify(adminGuilds)};</script>`
    );
    res.send(html);
});

app.get("/api/guild-meta/:guildId", checkAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: "السيرفر غير موجود" });

    try {
        await guild.members.fetch();
        const roles = guild.roles.cache.filter(r => r.name !== "@everyone").map(r => ({ id: r.id, name: r.name }));
        const channels = guild.channels.cache;
        const textChannels = channels.filter(c => c.type === ChannelType.GuildText).map(c => ({ id: c.id, name: c.name }));
        const voiceChannels = channels.filter(c => c.type === ChannelType.GuildVoice).map(c => ({ id: c.id, name: c.name }));

        res.json({ roles, textChannels, voiceChannels });
    } catch (error) {
        console.error(`Error fetching guild meta for ${req.params.guildId}:`, error);
        res.status(500).json({ error: "خطأ في جلب بيانات السيرفر" });
    }
});

app.get("/api/clans/:guildId", checkAuth, async (req, res) => {
    const guildId = req.params.guildId;
    const Clan = require("./models/Clan");
    try {
        let clans = await Clan.find({ guildId }).sort({ clanIndex: 1 });
        if (clans.length === 0) {
            const newClans = [];
            for (let i = 1; i <= 8; i++) {
                newClans.push({ clanIndex: i, guildId: guildId });
            }
            await Clan.insertMany(newClans);
            clans = await Clan.find({ guildId }).sort({ clanIndex: 1 });
        }
        res.json(clans);
    } catch (err) {
        console.error("خطأ في جلب بيانات الكلانات:", err);
        res.status(500).send("خطأ في جلب البيانات");
    }
});

app.post("/api/clans/update", checkAuth, async (req, res) => {
    const { guildId, clanIndex, leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, resultsChannelId, applyContent, pointsName, q1, q2, q3 } = req.body;
    const Clan = require("./models/Clan");
    const crypto = require("crypto");
    try {
        const hasPerm = req.user.guilds.some(g => g.id === guildId && hasAdminPermissions(g.permissions));
        if (!hasPerm) return res.status(403).send("غير مصرح لك.");

        if (!guildId || !clanIndex) return res.status(400).send("بيانات غير كاملة.");

        const newToken = crypto.randomBytes(16).toString("hex");
        await Clan.findOneAndUpdate({ guildId, clanIndex: parseInt(clanIndex) }, {
            leaderId, clanName, roleId, textChannelId, voiceChannelId, applyChannelId, resultsChannelId, applyContent, pointsName,
            questions: [q1, q2, q3].filter(q => q && q.trim() !== ""),
            sessionToken: newToken,
        }, { upsert: true, new: true });

        res.status(200).send("تم حفظ الإعدادات بنجاح!");
    } catch (err) {
        console.error("خطأ في حفظ إعدادات الكلان:", err);
        res.status(500).send("خطأ في الحفظ");
    }
});

app.post("/api/update-embed", checkAuth, async (req, res) => {
    const { guildId, clanIndex } = req.body;
    try {
        const hasPerm = req.user.guilds.some(g => g.id === guildId && hasAdminPermissions(g.permissions));
        if (!hasPerm) return res.status(403).send("غير مصرح لك.");

        await updateApplyEmbed(guildId, clanIndex);
        res.status(200).send("تم تحديث رسالة التقديم بنجاح!");
    } catch (error) {
        console.error("خطأ في تحديث رسالة التقديم عبر API:", error);
        res.status(500).send("فشل تحديث رسالة التقديم.");
    }
});

// Discord Bot Functions
async function updateApplyEmbed(guildId, clanIndex) {
    const Clan = require("./models/Clan");
    try {
        const clan = await Clan.findOne({ guildId, clanIndex });
        if (!clan || !clan.applyChannelId) return console.log(`No clan or applyChannelId for guild ${guildId}, clan ${clanIndex}`);

        const channel = await client.channels.fetch(clan.applyChannelId).catch(e => {
            console.error(`Failed to fetch apply channel ${clan.applyChannelId}:`, e.message);
            return null;
        });
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(`تقديم الانضمام إلى كلان: ${clan.clanName || "غير محدد"}`)
            .setDescription(clan.applyContent || "اضغط على الزر أدناه للتقديم.")
            .setColor(0x38bdf8);

        const button = new ButtonBuilder()
            .setCustomId(`applybtn_${guildId}_${clanIndex}`)
            .setLabel("تقديم طلب انضمام")
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(button);

        const messages = await channel.messages.fetch({ limit: 100 }).catch(e => {
            console.error(`Failed to fetch messages in channel ${channel.id}:`, e.message);
            return null;
        });
        const botMsg = messages?.find(m => m.author.id === client.user.id);

        if (botMsg) {
            await botMsg.edit({ embeds: [embed], components: [row] }).catch(e => console.error("Failed to edit bot message:", e.message));
        } else {
            await channel.send({ embeds: [embed], components: [row] }).catch(e => console.error("Failed to send new bot message:", e.message));
        }
    } catch (e) {
        console.error("خطأ في تحديث إمبد التقديم:", e);
    }
}

// Discord Interaction Handling
client.on("interactionCreate", async interaction => {
    const Clan = require("./models/Clan");
    const crypto = require("crypto");
    try {
        if (interaction.isModalSubmit() && interaction.customId.startsWith("clan_modal_")) {
            const parts = interaction.customId.replace("clan_modal_", "").split("__");
            const action = parts[0];
            const clanIndex = parseInt(parts[1]);
            const guildId = interaction.guild.id;

            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: "الكلان غير موجود.", ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const targetId = interaction.fields.getTextInputValue("target_user_id").trim();
            const member = await interaction.guild.members.fetch(targetId).catch(e => {
                console.error(`Failed to fetch member ${targetId}:`, e.message);
                return null;
            });
            const responseEmbed = new EmbedBuilder().setColor(0x38bdf8);

            if (action === "add_member") {
                if (!member) return interaction.editReply({ content: "العضو غير موجود." });
                if (!clan.members.some(m => m.userId === targetId)) {
                    clan.members.push({ userId: targetId, points: 0, messageCount: 0, voiceMinutes: 0 });
                    await clan.save();
                }
                if (clan.roleId && member) await member.roles.add(clan.roleId).catch(e => console.error(`Failed to add role to member ${targetId}:`, e.message));
                responseEmbed.setTitle("تمت الإضافة").setDescription(`تم إضافة <@${targetId}> للكلان.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === "remove_member") {
                clan.members = clan.members.filter(m => m.userId !== targetId);
                await clan.save();
                if (member && clan.roleId) await member.roles.remove(clan.roleId).catch(e => console.error(`Failed to remove role from member ${targetId}:`, e.message));
                responseEmbed.setTitle("تم الطرد").setDescription(`تم طرد <@${targetId}> من الكلان.`);
                return interaction.editReply({ embeds: [responseEmbed] });
            }

            if (action === "check_member") {
                const data = clan.members.find(m => m.userId === targetId);
                responseEmbed.setTitle("إحصائيات العضو")
                    .setDescription(`العضو: <@${targetId}>\nالنقاط: \`${data ? data.points : 0}\` \`${clan.pointsName}\`\nالرسائل: \`${data ? data.messageCount : 0}\`\nدقائق الصوت: \`${data ? data.voiceMinutes : 0}\``);
                return interaction.editReply({ embeds: [responseEmbed] });
            }
        }

        if (interaction.isButton() && interaction.customId.startsWith("applybtn_")) {
            const parts = interaction.customId.split("_");
            const guildId = parts[1];
            const clanIndex = parseInt(parts[2]);
            const clan = await Clan.findOne({ guildId, clanIndex });

            if (!clan) return interaction.reply({ content: "الكلان غير موجود.", ephemeral: true });

            const blacklistEntry = clan.blacklist.find(b => b.userId === interaction.user.id);
            if (blacklistEntry && blacklistEntry.until > new Date()) {
                return interaction.reply({ content: `أنت محظور من التقديم حالياً حتى ${blacklistEntry.until.toLocaleString()}.`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const thread = await interaction.channel.threads.create({
                name: `تقديم-${interaction.user.username}`,
                autoArchiveDuration: 60,
                type: ChannelType.PrivateThread,
                reason: "طلب تقديم",
                invitable: false
            }).catch(e => {
                console.error("Failed to create thread:", e.message);
                return null;
            });

            if (!thread) return interaction.editReply({ content: "فشل إنشاء الروم. يرجى التأكد من صلاحيات البوت." });
            await thread.members.add(interaction.user.id).catch(e => console.error("Failed to add user to thread:", e.message));
            await interaction.editReply({ content: `تم فتح روم التقديم: ${thread}` });

            const questions = clan.questions?.filter(q => q.trim() !== "") || ["السؤال 1", "السؤال 2", "السؤال 3"];
            const answers = [];

            for (let i = 0; i < questions.length; i++) {
                await thread.send({ content: `**السؤال ${i + 1}:** ${questions[i]}` });
                const collected = await thread.awaitMessages({ filter: m => m.author.id === interaction.user.id, max: 1, time: 120000, errors: ["time"] })
                    .catch(e => {
                        console.error("Failed to collect message in thread:", e.message);
                        return null;
                    });
                if (!collected || collected.size === 0) {
                    await thread.send({ content: "انتهى الوقت المخصص للإجابة أو حدث خطأ. سيتم إغلاق الروم." });
                    return setTimeout(() => thread.delete().catch(e => console.error("Failed to delete thread after timeout:", e.message)), 5000);
                }
                answers.push(collected.first().content);
            }

            await thread.send({ content: "تم إرسال طلبك. سيتم مراجعته قريباً." });
            await thread.setLocked(true).catch(e => console.error("Failed to lock thread:", e.message));
            await thread.setArchived(true).catch(e => console.error("Failed to archive thread:", e.message));

            const resultsChannel = await client.channels.fetch(clan.resultsChannelId).catch(e => {
                console.error(`Failed to fetch results channel ${clan.resultsChannelId}:`, e.message);
                return null;
            });
            if (resultsChannel) {
                const embed = new EmbedBuilder().setTitle(`طلب انضمام: ${clan.clanName}`).setDescription(`المقدم: <@${interaction.user.id}>`).setColor(0xffff00);
                questions.forEach((q, idx) => embed.addFields({ name: q, value: answers[idx] || "لا توجد إجابة", inline: false }));

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`accept_${guildId}_${interaction.user.id}_${clanIndex}_${clan.sessionToken}`).setLabel("قبول").setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`reject_${guildId}_${interaction.user.id}_${clanIndex}_${clan.sessionToken}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
                );
                await resultsChannel.send({ embeds: [embed], components: [row] }).catch(e => console.error("Failed to send application to results channel:", e.message));
            } else {
                console.warn(`Results channel ${clan.resultsChannelId} not found for guild ${guildId}. Application not sent.`);
            }
        }

        if (interaction.isButton() && (interaction.customId.startsWith("accept_") || interaction.customId.startsWith("reject_"))) {
            const [action, guildId, applicantId, clanIndexStr, token] = interaction.customId.split("_");
            const clanIndex = parseInt(clanIndexStr);
            const clan = await Clan.findOne({ guildId, clanIndex });

            if (!clan) return interaction.reply({ content: "الكلان غير موجود.", ephemeral: true });
            if (interaction.user.id !== clan.leaderId) return interaction.reply({ content: "لست القائد المخول لاتخاذ هذا الإجراء.", ephemeral: true });
            if (clan.sessionToken !== token) return interaction.reply({ content: "الزر منتهي الصلاحية أو تم تحديث إعدادات الكلان. يرجى استخدام زر جديد.", ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const applicant = await interaction.guild.members.fetch(applicantId).catch(e => {
                console.error(`Failed to fetch applicant ${applicantId}:`, e.message);
                return null;
            });

            if (!applicant) return interaction.editReply({ content: "لم يتم العثور على المتقدم في السيرفر." });

            if (action === "accept") {
                const allClans = await Clan.find({ guildId });
                for (const c of allClans) {
                    if (c.clanIndex !== clanIndex && c.roleId && applicant?.roles.cache.has(c.roleId)) {
                        await applicant.roles.remove(c.roleId).catch(e => console.error(`Failed to remove role ${c.roleId} from ${applicantId}:`, e.message));
                        c.members = c.members.filter(m => m.userId !== applicantId);
                        await c.save().catch(e => console.error(`Failed to save clan ${c.clanName} after member removal:`, e.message));
                    }
                }
                if (!clan.members.some(m => m.userId === applicantId)) {
                    clan.members.push({ userId: applicantId, points: 0, messageCount: 0, voiceMinutes: 0 });
                    await clan.save().catch(e => console.error(`Failed to save clan ${clan.clanName} after member addition:`, e.message));
                }
                if (clan.roleId && applicant) await applicant.roles.add(clan.roleId).catch(e => console.error(`Failed to add role ${clan.roleId} to ${applicantId}:`, e.message));
                await interaction.editReply({ content: `تم قبول <@${applicantId}> في كلان ${clan.clanName}.` });
                await applicant.send(`تهانينا! تم قبولك في كلان ${clan.clanName} في سيرفر ${interaction.guild.name}.`).catch(e => console.error("Failed to DM applicant:", e.message));
            } else { // reject
                const until = new Date();
                until.setDate(until.getDate() + 3);
                clan.blacklist.push({ userId: applicantId, until });
                await clan.save().catch(e => console.error(`Failed to save clan ${clan.clanName} after blacklist:`, e.message));
                await interaction.editReply({ content: `تم رفض <@${applicantId}> وتمت إضافته إلى القائمة السوداء لمدة 3 أيام.` });
                await applicant.send(`للأسف، تم رفض طلب انضمامك إلى كلان ${clan.clanName} في سيرفر ${interaction.guild.name}. لن تتمكن من التقديم مرة أخرى لمدة 3 أيام.`).catch(e => console.error("Failed to DM applicant:", e.message));
            }
            await interaction.message.delete().catch(e => console.error("Failed to delete interaction message:", e.message));
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith("leader_menu_")) {
            const [_, __, guildId, clanIndexStr] = interaction.customId.split("_");
            const clanIndex = parseInt(clanIndexStr);
            const clan = await Clan.findOne({ guildId, clanIndex });
            if (!clan) return interaction.reply({ content: "الكلان غير موجود.", ephemeral: true });
            if (interaction.user.id !== clan.leaderId) return interaction.reply({ content: "لست القائد المخول لاستخدام هذه القائمة.", ephemeral: true });

            const selection = interaction.values[0];
            if (selection === "info") {
                const embed = new EmbedBuilder().setTitle(`معلومات: ${clan.clanName}`).addFields(
                    { name: "النقاط الكلية (الخزنة)", value: `${clan.clanVaultPoints} ${clan.pointsName}`, inline: true },
                    { name: "عدد الأعضاء", value: `${clan.members.length}`, inline: true }
                ).setColor(0x38bdf8);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            if (selection === "total_points") {
                return interaction.reply({ content: `نقاط الخزنة: ${clan.clanVaultPoints} ${clan.pointsName}`, ephemeral: true });
            }

            const modal = new ModalBuilder().setCustomId(`clan_modal_${selection}__${clanIndex}`).setTitle("تحكم العضو");
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId("target_user_id").setLabel("ID العضو").setStyle(TextInputStyle.Short).setRequired(true)
            ));
            await interaction.showModal(modal);
        }
    } catch (err) {
        console.error("خطأ في معالجة التفاعل:", err);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: "حدث خطأ أثناء معالجة طلبك." }).catch(e => console.error("Failed to edit reply after error:", e.message));
        } else {
            await interaction.reply({ content: "حدث خطأ أثناء معالجة طلبك.", ephemeral: true }).catch(e => console.error("Failed to reply after error:", e.message));
        }
    }
});

// Message Create Event (for points system)
const chatCooldowns = new Map();
client.on("messageCreate", async message => {
    if (message.author.bot || !message.guild) return;

    const Clan = require("./models/Clan");
    if (message.content === "تحكم") {
        const clan = await Clan.findOne({ guildId: message.guild.id, textChannelId: message.channel.id });
        if (clan && message.author.id === clan.leaderId) {
            const menu = new StringSelectMenuBuilder().setCustomId(`leader_menu_${message.guild.id}_${clan.clanIndex}`).setPlaceholder("قائمة التحكم")
                .addOptions([
                    { label: "معلومات الكلان", value: "info" },
                    { label: "إضافة عضو", value: "add_member" },
                    { label: "طرد عضو", value: "remove_member" },
                    { label: "إحصائيات عضو", value: "check_member" },
                    { label: "نقاط الخزنة", value: "total_points" }
                ]);
            return message.reply({ content: "قائمة التحكم بالكلان:", components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
        }
    }

    // Points System for messages
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
        await activeClan.save().catch(e => console.error("Failed to save clan after message points update:", e.message));
    }
});

// Voice State Update Event (for voice minutes points system)
const voiceStart = new Map();
client.on("voiceStateUpdate", async (oldS, newS) => {
    const Clan = require("./models/Clan");
    const mId = newS.member?.id || oldS.member?.id;
    const gId = newS.guild?.id || oldS.guild?.id;
    if (!mId || !gId) return;

    if (newS.channelId && !oldS.channelId) {
        voiceStart.set(mId, Date.now());
    }
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
                    await clan.save().catch(e => console.error("Failed to save clan after voice points update:", e.message));
                }
            }
            voiceStart.delete(mId);
        }
    }
});

// Guild Create Event (Bot joins a new guild)
client.on("guildCreate", async guild => {
    const Clan = require("./models/Clan");
    try {
        const existingClans = await Clan.countDocuments({ guildId: guild.id });
        if (existingClans === 0) {
            const newClans = [];
            for (let i = 1; i <= 8; i++) {
                newClans.push({ clanIndex: i, guildId: guild.id });
            }
            await Clan.insertMany(newClans);
            console.log(`Created 8 default clans for new guild: ${guild.name} (${guild.id})`);
        }
    } catch (error) {
        console.error(`Error creating default clans for new guild ${guild.id}:`, error);
    }
});

client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`الداشبورد يعمل على المنفذ: ${PORT}`));
