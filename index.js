// ╔══════════════════════════════════════════════════════════════════════════╗
// ║                   🎵 MUSIC BOT - Discord Bot 🎵                          ║
// ║              ملف واحد - كل الميزات - JavaScript                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    Events
} = require('discord.js');

const { Player, QueryType } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 إعدادات
// ═══════════════════════════════════════════════════════════════════════════

const TOKEN = process.env.DISCORD_TOKEN || 'ضع_توكن_البوت_هنا';
const SAVES_FILE = path.join(__dirname, 'saves.json');

// ═══════════════════════════════════════════════════════════════════════════
// 💾 نظام المحفوظات
// ═══════════════════════════════════════════════════════════════════════════

function loadSaves() {
    try {
        if (fs.existsSync(SAVES_FILE)) {
            return JSON.parse(fs.readFileSync(SAVES_FILE, 'utf-8'));
        }
    } catch (e) { /* ignore */ }
    return {};
}

function saveSaves(data) {
    try {
        fs.writeFileSync(SAVES_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[SAVES] خطأ في الحفظ:', e.message);
    }
}

let saves = loadSaves();

function getUserSaves(userId) {
    if (!saves[userId]) saves[userId] = [];
    return saves[userId];
}

function addSave(userId, track) {
    const userSaves = getUserSaves(userId);
    const exists = userSaves.find(s => s.url === track.url);
    if (!exists) {
        userSaves.push({
            title: track.title,
            author: track.author || 'غير معروف',
            duration: track.duration,
            url: track.url,
            thumbnail: track.thumbnail || '',
            addedAt: new Date().toISOString()
        });
        saveSaves(saves);
        return true;
    }
    return false;
}

function removeSave(userId, index) {
    const userSaves = getUserSaves(userId);
    if (userSaves[index]) {
        userSaves.splice(index, 1);
        saveSaves(saves);
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🤖 إعداد البوت
// ═══════════════════════════════════════════════════════════════════════════

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

const player = new Player(client);

// ═══════════════════════════════════════════════════════════════════════════
// 🎧 إعداد المشغل (Player Events)
// ═══════════════════════════════════════════════════════════════════════════

// عند بدء تشغيل أغنية جديدة
player.events.on('playerStart', (queue, track) => {
    sendNowPlayingMessage(queue, track);
});

// عند انتهاء أغنية - إضافة تلقائية للمحفوظات
player.events.on('playerFinish', (queue) => {
    const currentTrack = queue.previousTrack;
    if (currentTrack && queue.metadata?.userId) {
        const userId = queue.metadata.userId;
        const wasAdded = addSave(userId, currentTrack);
        if (wasAdded && queue.metadata.channel) {
            try {
                queue.metadata.channel.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setDescription(`✅ تم حفظ **${truncate(currentTrack.cleanTitle, 50)}** في المحفوظات تلقائياً!`)
                        .setFooter({ text: 'استخدم /saves لمشاهدة المحفوظات' })
                    ]
                });
            } catch (e) { /* ignore */ }
        }
    }
});

// عند إيقاف مؤقت
player.events.on('playerPause', (queue, track) => {
    updateNowPlayingMessage(queue, track, '▶️ تم الإيقاف المؤقت');
});

// عند استئناف التشغيل
player.events.on('playerResume', (queue, track) => {
    updateNowPlayingMessage(queue, track, '▶️ تم الاستئناف');
});

// عند تغيير الصوت
player.events.on('playerVolumeUpdate', (queue, volume) => {
    if (queue.metadata?.nowPlayingMsgId) {
        try {
            updateNowPlayingMessage(queue, queue.currentTrack);
        } catch (e) { /* ignore */ }
    }
});

// عند تغيير القناة الصوتية
player.events.on('playerDisconnect', (queue) => {
    if (queue.metadata?.nowPlayingMsgId && queue.metadata.channel) {
        try {
            queue.metadata.channel.messages.fetch(queue.metadata.nowPlayingMsgId)
                .then(msg => msg.edit({
                    components: [],
                    embeds: [new EmbedBuilder()
                        .setColor(0x333333)
                        .setDescription('🔇 تم مغادرة القناة الصوتية')
                    ]
                }))
                .catch(() => {});
        } catch (e) { /* ignore */ }
    }
});

// عند خطأ
player.events.on('error', (queue, error) => {
    console.error(`[PLAYER ERROR] ${error.message}`);
    if (queue.metadata?.channel) {
        try {
            queue.metadata.channel.send({
                embeds: [new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ حدث خطأ')
                    .setDescription(error.message)
                ]
            });
        } catch (e) { /* ignore */ }
    }
});

// عند انقطاع الاتصال
player.events.on('debug', (queue, message) => {
    // يمكن تفعيل للتصحيح
    // console.log(`[DEBUG] ${message}`);
});

// عند إضافة أغنية للقائمة
player.events.on('queueAddTrack', (queue, track) => {
    // يمكن إضافة إشعار هنا
});

// ═══════════════════════════════════════════════════════════════════════════
// 📤 دوال الرسائل
// ═══════════════════════════════════════════════════════════════════════════

function truncate(str, len) {
    return str.length > len ? str.substring(0, len) + '...' : str;
}

function formatDuration(duration) {
    if (!duration) return 'غير معروف';
    const mins = Math.floor(duration / 60000);
    const secs = Math.floor((duration % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatQueueDuration(queue) {
    const totalMs = queue.tracks.data.reduce((sum, t) => sum + (t.duration || 0), 0);
    return formatDuration(totalMs);
}

function createNowPlayingEmbed(track, queue, extraMsg) {
    const progressBar = queue ? generateProgressBar(queue) : '─────────────';

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎵 مشغّل الموسيقى')
        .setThumbnail(track.thumbnail || track.author?.avatar || null)
        .addFields(
            {
                name: 'الأغنية الحالية',
                value: `**${truncate(track.cleanTitle || track.title, 100)}**\n` +
                       `👤 **بواسطة:** ${track.author || 'غير معروف'}\n` +
                       `⏱️ **المدة:** ${formatDuration(track.duration)}`,
                inline: true
            },
            {
                name: 'معلومات القائمة',
                value: `📊 **عدد الأغاني:** ${queue ? queue.tracks.size : 0}\n` +
                       `⏰ **المدة الكلية:** ${queue ? formatQueueDuration(queue) : 'غير معروف'}\n` +
                       `🔊 **الصوت:** ${queue ? queue.node.volume : 100}%`,
                inline: true
            },
            { name: '\u200b', value: progressBar, inline: false }
        )
        .setFooter({
            text: extraMsg || 'استخدم الأزرار للتحكم'
        })
        .setTimestamp();
}

function generateProgressBar(queue) {
    if (!queue.currentTrack || !queue.currentTrack.duration) {
        return '━━━━━━━━━━━━━━━━━━━━';
    }

    const duration = queue.currentTrack.duration;
    const current = queue.node.getTime() || 0;
    const progress = Math.min((current / duration) * 100, 100);

    const filled = Math.round(progress / 5);
    const empty = 20 - filled;
    const bar = '▓'.repeat(filled) + '░'.repeat(empty);
    const currentPos = formatDuration(current);
    const totalPos = formatDuration(duration);

    return `${currentPos} ━ ${bar} ━ ${totalPos}`;
}

function createControlButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_previous')
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_pause')
                .setEmoji('⏸️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('btn_next')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_loop')
                .setEmoji('🔁')
                .setStyle(ButtonStyle.Secondary)
        );
}

function createVolumeButtons(volume) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_vol_down')
                .setEmoji('🔉')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_vol_up')
                .setEmoji('🔊')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setDisabled(true)
                .setLabel(`${volume || 100}%`)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('btn_skip_to')
                .setEmoji('⏩')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_back_menu')
                .setEmoji('🔙')
                .setStyle(ButtonStyle.Secondary)
        );
}

function createMenuRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_now_playing')
                .setEmoji('🎵')
                .setLabel('مشغّل الآن')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('btn_queue')
                .setEmoji('📋')
                .setLabel('القائمة')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_volume')
                .setEmoji('🔊')
                .setLabel('الصوت')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_saves')
                .setEmoji('💾')
                .setLabel('محفوظاتي')
                .setStyle(ButtonStyle.Secondary)
        );
}

function createLoopRow(loopMode) {
    const loopEmoji = loopMode === 'off' ? '🔁' : loopMode === 'track' ? '🔂' : '🔁';
    const loopLabel = loopMode === 'off' ? 'بدون تكرار' : loopMode === 'track' ? 'كرر أغنية' : 'كرر القائمة';
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('btn_loop_mode')
                .setEmoji(loopEmoji)
                .setLabel(loopLabel)
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('btn_saves')
                .setEmoji('💾')
                .setLabel('محفوظاتي')
                .setStyle(ButtonStyle.Secondary)
        );
}

// ═══════════════════════════════════════════════════════════════════════════
// 📡 رسائل Now Playing
// ═══════════════════════════════════════════════════════════════════════════

function sendNowPlayingMessage(queue, track) {
    if (!queue.metadata?.channel) return;

    const embed = createNowPlayingEmbed(track, queue);
    const buttons = createControlButtons();
    const menu = createMenuRow();

    queue.metadata.channel.send({
        embeds: [embed],
        components: [buttons, menu]
    }).then(msg => {
        queue.metadata.nowPlayingMsgId = msg.id;
    }).catch(() => {});
}

function updateNowPlayingMessage(queue, track, extraMsg) {
    if (!queue.metadata?.nowPlayingMsgId || !queue.metadata?.channel) return;

    queue.metadata.channel.messages.fetch(queue.metadata.nowPlayingMsgId)
        .then(msg => {
            const embed = createNowPlayingEmbed(track, queue, extraMsg);
            msg.edit({ embeds: [embed] }).catch(() => {});
        })
        .catch(() => {
            sendNowPlayingMessage(queue, track);
        });
}

// ═══════════════════════════════════════════════════════════════════════════
// ⌨️ الأوامر (Slash Commands)
// ═══════════════════════════════════════════════════════════════════════════

// أمر التشغيل
const playCommand = {
    name: 'play',
    description: 'تشغيل أغنية أو قائمة تشغيل',
    options: [{
        name: 'query',
        description: 'اسم الأغنية أو رابط يوتيوب/سبوتيفاي',
        type: 3, // STRING
        required: true,
        autocomplete: true
    }]
};

// أمر التخطي
const skipCommand = {
    name: 'skip',
    description: 'تخطي الأغنية الحالية'
};

// أمر الإيقاف
const stopCommand = {
    name: 'stop',
    description: 'إيقاف التشغيل ومغادرة القناة الصوتية'
};

// أمر القائمة
const queueCommand = {
    name: 'queue',
    description: 'عرض قائمة التشغيل الحالية'
};

// أمر المحفوظات
const savesCommand = {
    name: 'saves',
    description: 'عرض أغانيك المحفوظة'
};

// أمر مسح المحفوظات
const clearSavesCommand = {
    name: 'clearsaves',
    description: 'مسح جميع المحفوظات'
};

// أمر الصوت
const volumeCommand = {
    name: 'volume',
    description: 'تعديل مستوى الصوت',
    options: [{
        name: 'level',
        description: 'مستوى الصوت (1-100)',
        type: 4, // INTEGER
        required: true,
        min_value: 1,
        max_value: 100
    }]
};

// أمر التكرار
const loopCommand = {
    name: 'loop',
    description: 'تفعيل/تعطيل التكرار',
    options: [{
        name: 'mode',
        description: 'وضع التكرار',
        type: 3, // STRING
        required: true,
        choices: [
            { name: 'بدون تكرار', value: 'off' },
            { name: 'كرر الأغنية', value: 'track' },
            { name: 'كرر القائمة', value: 'queue' }
        ]
    }]
};

// أمر البحث
const searchCommand = {
    name: 'search',
    description: 'البحث عن أغنية بدون تشغيلها',
    options: [{
        name: 'query',
        description: 'ما تريد البحث عنه',
        type: 3, // STRING
        required: true
    }]
};

// ═══════════════════════════════════════════════════════════════════════════
// 🔌 عند الاتصال
// ═══════════════════════════════════════════════════════════════════════════

client.once(Events.ClientReady, async () => {
    console.log(`✅ البوت متصل بنجاح!`);
    console.log(`👤 الاسم: ${client.user.tag}`);
    console.log(`🌐 السيرفرات: ${client.guilds.cache.size}`);

    // تسجيل الأوامر
    const commands = [
        playCommand, skipCommand, stopCommand, queueCommand,
        savesCommand, clearSavesCommand, volumeCommand, loopCommand, searchCommand
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ تم تسجيل الأوامر بنجاح!');
    } catch (error) {
        console.error('❌ خطأ في تسجيل الأوامر:', error);
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔄 معالجة التفاعلات
// ═══════════════════════════════════════════════════════════════════════════

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton() && !interaction.isAutocomplete()) return;

    // ═══════════════════════════════════════════════════════════
    // 🔍 بحث تلقائي (Autocomplete)
    // ═══════════════════════════════════════════════════════════
    if (interaction.isAutocomplete()) {
        if (interaction.commandName !== 'play') return;
        const query = interaction.options.getFocused();
        if (!query || query.length < 2) {
            await interaction.respond([]);
            return;
        }

        try {
            const searchResults = await player.search(query, {
                requestedBy: interaction.user,
                searchEngine: QueryType.YOUTUBE_SEARCH
            });

            const suggestions = searchResults.tracks
                .slice(0, 25)
                .map(track => ({
                    name: truncate(`${track.cleanTitle} - ${track.author}`, 100),
                    value: track.url
                }));

            await interaction.respond(suggestions.length > 0 ? suggestions : []);
        } catch (e) {
            await interaction.respond([]);
        }
        return;
    }

    // ═══════════════════════════════════════════════════════════
    // 🎮 أزرار التحكم
    // ═══════════════════════════════════════════════════════════

    const queue = player.queues.get(interaction.guild.id);

    // أزرار التحكم الأساسية
    if (interaction.customId === 'btn_previous') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        queue.node.previous();
        await interaction.reply({ content: '⏮️ تم التشغيل للأغنية السابقة', ephemeral: true });
        return;
    }

    if (interaction.customId === 'btn_pause') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        if (queue.node.isPlaying()) {
            queue.node.setPaused(true);
            await interaction.reply({ content: '⏸️ تم الإيقاف المؤقت', ephemeral: true });
        } else {
            queue.node.setPaused(false);
            await interaction.reply({ content: '▶️ تم الاستئناف', ephemeral: true });
        }
        return;
    }

    if (interaction.customId === 'btn_stop') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        queue.delete();
        await interaction.reply({ content: '⏹️ تم إيقاف التشغيل ومغادرة القناة الصوتية', ephemeral: true });
        return;
    }

    if (interaction.customId === 'btn_next') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        if (queue.tracks.size <= 1) return interaction.reply({ content: '❌ لا يوجد أغاني في القائمة', ephemeral: true });
        queue.node.skip();
        await interaction.reply({ content: '⏭️ تم تخطي الأغنية', ephemeral: true });
        return;
    }

    if (interaction.customId === 'btn_loop') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        queue.node.setRepeatMode(queue.node.getRepeatMode() === 0 ? 2 : 0);
        const mode = queue.node.getRepeatMode() === 2 ? '🔁 تكرار القائمة مفعّل' : '⏭️ تم تعطيل التكرار';
        await interaction.reply({ content: mode, ephemeral: true });
        return;
    }

    // أزرار الصوت
    if (interaction.customId === 'btn_vol_down') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        const newVol = Math.max(1, queue.node.volume - 10);
        queue.node.setVolume(newVol);
        await interaction.reply({ content: `🔉 تم تخفيض الصوت إلى ${newVol}%`, ephemeral: true });
        return;
    }

    if (interaction.customId === 'btn_vol_up') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        const newVol = Math.min(100, queue.node.volume + 10);
        queue.node.setVolume(newVol);
        await interaction.reply({ content: `🔊 تم رفع الصوت إلى ${newVol}%`, ephemeral: true });
        return;
    }

    // أزرار القوائم
    if (interaction.customId === 'btn_now_playing') {
        if (!queue || !queue.currentTrack) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        await interaction.reply({
            embeds: [createNowPlayingEmbed(queue.currentTrack, queue)],
            ephemeral: true
        });
        return;
    }

    if (interaction.customId === 'btn_queue') {
        if (!queue || queue.tracks.size === 0) return interaction.reply({ content: '❌ القائمة فارغة', ephemeral: true });
        const tracks = queue.tracks.data.slice(0, 10);
        const trackList = tracks.map((t, i) => `${i + 1}. **${truncate(t.cleanTitle, 60)}**`).join('\n');
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📋 قائمة التشغيل')
                .setDescription(trackList)
                .setFooter({ text: `المدة الكلية: ${formatQueueDuration(queue)} | عدد الأغاني: ${queue.tracks.size}` })
            ],
            ephemeral: true
        });
        return;
    }

    if (interaction.customId === 'btn_volume') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🔊 التحكم بالصوت')
                .setDescription(`المستوى الحالي: **${queue.node.volume}%**`)
                .addFields(
                    { name: '\u200b', value: 'استخدم الأزرار لتعديل الصوت:', inline: false }
                )
            ],
            components: [createVolumeButtons(queue.node.volume)],
            ephemeral: true
        });
        return;
    }

    if (interaction.customId === 'btn_back_menu') {
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎵 قائمة التحكم الرئيسية')
                .setDescription('اختار من الأزرار أدناه للتحكم في المشغّل')
            ],
            components: [createControlButtons(), createMenuRow()],
            ephemeral: true
        });
        return;
    }

    if (interaction.customId === 'btn_loop_mode') {
        if (!queue || !queue.isPlaying()) return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
        const currentMode = queue.node.getRepeatMode();
        const nextMode = currentMode === 0 ? 2 : currentMode === 2 ? 1 : 0;
        queue.node.setRepeatMode(nextMode);
        const modeText = nextMode === 0 ? 'بدون تكرار' : nextMode === 2 ? 'كرر القائمة' : 'كرر أغنية';
        await interaction.reply({ content: `🔁 تم تغيير وضع التكرار إلى: **${modeText}**`, ephemeral: true });
        return;
    }

    if (interaction.customId === 'btn_saves') {
        const userSaves = getUserSaves(interaction.user.id);
        if (userSaves.length === 0) {
            return interaction.reply({ content: '💾 ليس لديك أي أغاني محفوظة! ستُضاف تلقائياً بعد انتهاء كل أغنية.', ephemeral: true });
        }
        const saveList = userSaves.slice(0, 10).map((s, i) =>
            `${i + 1}. **${truncate(s.title, 60)}** - ${s.author} (${formatDuration(s.duration)})`
        ).join('\n');
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('💾 محفوظاتي')
                .setDescription(saveList)
                .setFooter({ text: `إجمالي المحفوظات: ${userSaves.length} | استخدم /play [رابط] لإعادة تشغيلها` })
            ],
            ephemeral: true
        });
        return;
    }

    if (interaction.customId === 'btn_skip_to') {
        if (!queue || queue.tracks.size === 0) return interaction.reply({ content: '❌ لا يوجد أغاني في القائمة', ephemeral: true });
        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('⏩ قائمة القفز')
                .setDescription('رد برقم الأغنية للتخطي إليها')
            ],
            ephemeral: true
        });

        const filter = (m) => m.author.id === interaction.user.id && !isNaN(m.content);
        const collector = interaction.channel.createMessageCollector({ filter, time: 15000, max: 1 });

        collector.on('collect', (msg) => {
            const index = parseInt(msg.content) - 1;
            if (index >= 0 && index < queue.tracks.size) {
                queue.node.skipTo(index);
                interaction.followUp({ content: `⏩ تم التخطي إلى الأغنية رقم ${index + 1}`, ephemeral: true });
            } else {
                interaction.followUp({ content: '❌ رقم غير صحيح', ephemeral: true });
            }
            msg.delete().catch(() => {});
        });

        collector.on('end', (collected) => {
            if (collected.size === 0) {
                interaction.followUp({ content: '⏰ انتهى الوقت', ephemeral: true });
            }
        });
        return;
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// ⌨️ معالجة الأوامر
// ═══════════════════════════════════════════════════════════════════════════

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        // أمر التشغيل
        if (interaction.commandName === 'play') {
            await interaction.deferReply({ ephemeral: true });

            const channel = interaction.member.voice.channel;
            if (!channel) {
                return interaction.followUp({ content: '❌ لازم تكون داخل قناة صوتية!' });
            }

            if (!channel.permissionsFor(client.user).has(PermissionFlagsBits.Connect | PermissionFlagsBits.Speak)) {
                return interaction.followUp({ content: '❌ ما عندي صلاحية للاتحاد بالكوال الصوتية' });
            }

            const query = interaction.options.getString('query', true);

            try {
                const { track } = await player.play(channel, query, {
                    nodeOptions: {
                        metadata: {
                            channel: interaction.channel,
                            userId: interaction.user.id
                        },
                    },
                    requestedBy: interaction.user,
                    searchEngine: query.startsWith('http') ? QueryType.AUTO : QueryType.YOUTUBE_SEARCH
                });

                const queue = player.queues.get(interaction.guild.id);
                const isPlaylist = track.playlist !== null;

                if (isPlaylist) {
                    return interaction.followUp({
                        embeds: [new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('📋 تم إضافة قائمة تشغيل')
                            .setDescription(`**${truncate(track.playlist.title, 100)}**\n📊 عدد الأغاني: ${track.playlist.tracks.length}\n👤 بواسطة: ${track.playlist.author}`)
                        ]
                    });
                }

                return interaction.followUp({
                    embeds: [new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle('🎵 تم الإضافة للقائمة')
                        .setThumbnail(track.thumbnail || null)
                        .addFields(
                            { name: 'الأغنية', value: `**${truncate(track.cleanTitle, 100)}**`, inline: true },
                            { name: 'المدة', value: formatDuration(track.duration), inline: true },
                            { name: 'بواسطة', value: track.author || 'غير معروف', inline: true },
                            { name: '\u200b', value: `📊 عدد الأغاني في القائمة: ${queue.tracks.size}\n⏰ المدة الكلية: ${formatQueueDuration(queue)}`, inline: false }
                        )
                    ]
                });
            } catch (e) {
            return interaction.followUp({
                    embeds: [new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle('❌ خطأ')
                        .setDescription(`ما قدرت ألقا/ألعب الأغنية:\n\`${e.message || 'خطأ غير معروف'}\``)
                    ]
                });
            }
        }

        // أمر التخطي
        if (interaction.commandName === 'skip') {
            const queue = player.queues.get(interaction.guild.id);
            if (!queue || !queue.isPlaying()) {
                return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
            }
            queue.node.skip();
            await interaction.reply({ content: '⏭️ تم تخطي الأغنية', ephemeral: true });
        }

        // أمر الإيقاف
        if (interaction.commandName === 'stop') {
            const queue = player.queues.get(interaction.guild.id);
            if (!queue || !queue.isPlaying()) {
                return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
            }
            queue.delete();
            await interaction.reply({ content: '⏹️ تم إيقاف التشغيل ومغادرة القناة الصوتية', ephemeral: true });
        }

        // أمر القائمة
        if (interaction.commandName === 'queue') {
            const queue = player.queues.get(interaction.guild.id);
            if (!queue || queue.tracks.size === 0) {
                return interaction.reply({ content: '❌ القائمة فارغة', ephemeral: true });
            }

            const tracks = queue.tracks.data;
            const currentTrack = queue.currentTrack;
            let description = '';

            if (currentTrack) {
                description += `🎵 **الآن:** ${truncate(currentTrack.cleanTitle, 80)}\n\n`;
            }

            const tracksToShow = tracks.slice(0, 15);
            description += tracksToShow.map((t, i) =>
                `**${i + 1}.** ${truncate(t.cleanTitle, 60)} \`${formatDuration(t.duration)}\``
            ).join('\n');

            if (tracks.length > 15) {
                description += `\n\n... و ${tracks.length - 15} أغنية أخرى`;
            }

            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('📋 قائمة التشغيل')
                    .setDescription(description)
                    .setFooter({ text: `المدة الكلية: ${formatQueueDuration(queue)} | عدد الأغاني: ${tracks.length}` })
                ],
                ephemeral: true
            });
        }

        // أمر المحفوظات
        if (interaction.commandName === 'saves') {
            const userSaves = getUserSaves(interaction.user.id);
            if (userSaves.length === 0) {
                return interaction.reply({
                    embeds: [new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('💾 محفوظاتي')
                        .setDescription('ليس لديك أي أغاني محفوظة!\n\nستُضاف الأغاني تلقائياً بعد انتهاء كل أغنية.')
                    ],
                    ephemeral: true
                });
            }

            const saveList = userSaves.map((s, i) =>
                `**${i + 1}.** ${truncate(s.title, 60)} - ${s.author} \`${formatDuration(s.duration)}\``
            ).join('\n');

            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('💾 محفوظاتي')
                    .setDescription(saveList)
                    .setFooter({ text: `إجمالي المحفوظات: ${userSaves.length} | استخدم /play [رابط] لإعادة تشغيلها` })
                ],
                ephemeral: true
            });
        }

        // أمر مسح المحفوظات
        if (interaction.commandName === 'clearsaves') {
            saves[interaction.user.id] = [];
            saveSaves(saves);
            await interaction.reply({ content: '🗑️ تم مسح جميع المحفوظات!', ephemeral: true });
        }

        // أمر الصوت
        if (interaction.commandName === 'volume') {
            const queue = player.queues.get(interaction.guild.id);
            if (!queue || !queue.isPlaying()) {
                return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
            }
            const level = interaction.options.getInteger('level', true);
            queue.node.setVolume(level);
            await interaction.reply({
                content: `🔊 تم ضبط الصوت إلى **${level}%**`,
                ephemeral: true
            });
        }

        // أمر التكرار
        if (interaction.commandName === 'loop') {
            const queue = player.queues.get(interaction.guild.id);
            if (!queue || !queue.isPlaying()) {
                return interaction.reply({ content: '❌ لا يوجد تشغيل حالياً', ephemeral: true });
            }
            const mode = interaction.options.getString('mode', true);
            const modeMap = { off: 0, track: 1, queue: 2 };
            queue.node.setRepeatMode(modeMap[mode]);
            const modeText = mode === 'off' ? 'تم تعطيل التكرار' : mode === 'track' ? 'تم تفعيل تكرار الأغنية 🔂' : 'تم تفعيل تكرار القائمة 🔁';
            await interaction.reply({ content: modeText, ephemeral: true });
        }

        // أمر البحث
        if (interaction.commandName === 'search') {
            await interaction.deferReply({ ephemeral: true });
            const query = interaction.options.getString('query', true);

            try {
                const results = await player.search(query, {
                    requestedBy: interaction.user,
                    searchEngine: QueryType.YOUTUBE_SEARCH
                });

                if (!results.hasTracks() || results.tracks.length === 0) {
                return interaction.followUp({ content: '❌ ما لقينا أي نتيجة', ephemeral: true });
                }

                const embeds = results.tracks.slice(0, 10).map((track, i) =>
                    new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle(`#${i + 1} ${truncate(track.cleanTitle, 100)}`)
                        .setThumbnail(track.thumbnail || null)
                        .addFields(
                            { name: 'بواسطة', value: track.author || 'غير معروف', inline: true },
                            { name: 'المدة', value: formatDuration(track.duration), inline: true }
                        )
                        .setFooter({ text: 'استخدم /play مع اسم الأغنية لتشغيلها' })
                );

                await interaction.followUp({
                    embeds: [embeds[0]],
                    ephemeral: true
                });
            } catch (e) {
                await interaction.followUp({ content: '❌ حدث خطأ أثناء البحث', ephemeral: true });
            }
        }
    } catch (error) {
        console.error('❌ خطأ في معالجة الأمر:', error);
        if (interaction.isRepliable()) {
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: '❌ حدث خطأ غير متوقع', ephemeral: true });
                } else {
                    await interaction.reply({ content: '❌ حدث خطأ غير متوقع', ephemeral: true });
                }
            } catch (e) { /* ignore */ }
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚀 تشغيل البوت
// ═══════════════════════════════════════════════════════════════════════════

async function startBot() {
    // تحميل المستخرجين
    try {
        await player.extractors.loadMulti(DefaultExtractors);
        console.log('✅ تم تحميل المستخرجين بنجاح');
    } catch (error) {
        console.warn('⚠️ تحذير في تحميل المستخرجين:', error.message);
    }

    // تسجيل الدخول
    try {
        await client.login(TOKEN);
    } catch (error) {
        console.error('❌ خطأ في تسجيل الدخول:', error.message);
        console.error('تأكد من صحة التوكن في متغير البيئة DISCORD_TOKEN');
        process.exit(1);
    }
}

startBot();

// ═══════════════════════════════════════════════════════════════════════════
// 📝 ملاحظات
// ═══════════════════════════════════════════════════════════════════════════
/*
الأوامر المتاحة:
/play [اسم الأغنية أو الرابط]  - تشغيل أغنية
/skip                          - تخطي الأغنية الحالية
/stop                          - إيقاف التشغيل
/queue                         - عرض القائمة
/saves                         - عرض المحفوظات
/clearsaves                    - مسح المحفوظات
/volume [1-100]                - تغيير الصوت
/loop [off|track|queue]        - وضع التكرار
/search [اسم الأغنية]         - بحث عن أغنية

الميزات:
- بحث ذكي من يوتيوب مع اقتراحات تلقائية
- حفظ تلقائي للأغاني بعد انتهاءها
- أزرار تحكم كاملة (تشغيل/إيقاف/تخطي/تكرار/صوت)
- عرض معلومات الأغنية الحية مع شريط تقدم
- دعم يوتيوب، سبوتيفاي، ساوندكلاود، وروابط مباشرة
- بدون تقطيع في الصوت
- واجهة تفاعلية جميلة

للتشغيل:
1. ضع التوكن في DISCORD_TOKEN
2. npm install
3. node index.js
*/
