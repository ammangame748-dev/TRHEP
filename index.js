// ═══════════════════════════════════════════════════════════
// 🎮 DISCORD GAMES BOT - 10+ GAMES, SHOP, DASHBOARD, ROULETTE
// ═══════════════════════════════════════════════════════════

const { Client, GatewayIntentBits, ActivityType, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const ms = require('ms');

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean);

if (!TOKEN) { console.error('❌ DISCORD_TOKEN غير موجود في البيئة'); process.exit(1); }
if (!CLIENT_ID) { console.error('❌ CLIENT_ID غير موجود في البيئة'); process.exit(1); }

// ═══════════════════════════════════════════════════════════
// DATABASE SETUP
// ═══════════════════════════════════════════════════════════
const db = new Database(path.join(__dirname, 'games.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    coins INTEGER DEFAULT 500,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    inventory TEXT DEFAULT '[]',
    equipped TEXT DEFAULT '',
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    join_date TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL,
    category TEXT NOT NULL,
    emoji TEXT DEFAULT '📦',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS roulette_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    bet_amount INTEGER,
    result TEXT,
    won INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Initialize default settings
const defaultSettings = {
  'coins_per_win': '100',
  'xp_per_win': '50',
  'min_bet': '10',
  'max_bet': '10000',
  'roulette_spins': '12',
  'game_maintenance': '0', // 0 = off, 1 = on
  'welcome_message': '1',
  'daily_bonus': '200',
  'last_daily_check': '[]' // JSON array of {userId, date}
};

for (const [key, value] of Object.entries(defaultSettings)) {
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  stmt.run(key, value);
}

// Initialize default shop items
const defaultShopItems = [
  { name: 'درع حديدي', description: 'يحميك في الألعاب القتالية', price: 500, category: 'armor', emoji: '🛡️' },
  { name: 'سيف الأسطورة', description: 'قوة إضافية في المعارك', price: 1500, category: 'weapon', emoji: '⚔️' },
  { name: 'حذاء السرعة', description: 'يزيد من سرعتك في الألعاب', price: 800, category: 'armor', emoji: '👟' },
  { name: 'جوهرة الحظ', description: 'تزيد حظك في الروليت', price: 2000, category: 'special', emoji: '💎' },
  { name: 'تاج الذهبي', description: 'رمز الفخامة والسلطة', price: 5000, category: 'special', emoji: '👑' },
  { name: 'درع الماس', description: 'أقوى درع في اللعبة', price: 10000, category: 'armor', emoji: '💠' },
  { name: 'عصا السحر', description: 'سحر قوي للمبارزات', price: 3000, category: 'weapon', emoji: '🪄' },
  { name: 'بطلقة النينجا', description: 'أداة النينجا السرية', price: 2500, category: 'weapon', emoji: '🥷' },
];

const itemCount = db.prepare('SELECT COUNT(*) as count FROM shop_items').get().count;
if (itemCount === 0) {
  const insert = db.prepare('INSERT INTO shop_items (name, description, price, category, emoji) VALUES (?, ?, ?, ?, ?)');
  for (const item of defaultShopItems) {
    insert.run(item.name, item.description, item.price, item.category, item.emoji);
  }
}

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultSettings[key];
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value.toString());
}

function getUser(userId) {
  const stmt = db.prepare('INSERT OR IGNORE INTO users (id, coins, xp) VALUES (?, 500, 0)');
  stmt.run(userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function updateCoins(userId, amount) {
  const user = getUser(userId);
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, userId);
  return user.coins + amount;
}

function updateXP(userId, amount) {
  const user = getUser(userId);
  db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);
  // Check level up
  const newUser = getUser(userId);
  const newLevel = Math.floor(newUser.xp / 500) + 1;
  if (newLevel > user.level) {
    db.prepare('UPDATE users SET level = ? WHERE id = ?').run(newLevel, userId);
    return { leveledUp: true, newLevel };
  }
  return { leveledUp: false, level: user.level };
}

function recordWin(userId) {
  db.prepare('UPDATE users SET wins = wins + 1 WHERE id = ?').run(userId);
}

function recordLoss(userId) {
  db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').run(userId);
}

function createEmbed(title, description, color = '#5865F2') {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setFooter({ text: '🎮 Discord Games Bot | v2.0' })
    .setTimestamp();
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function formatCoins(amount) {
  if (amount >= 1000) return amount.toLocaleString() + ' 🪙';
  return amount + ' 🪙';
}

function createButtons(...buttons) {
  return new ActionRowBuilder().addComponents(buttons);
}

// ═══════════════════════════════════════════════════════════
// CLIENT SETUP
// ═══════════════════════════════════════════════════════════
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

client.commands = new Collection();
const activeGames = new Map(); // userId -> game data
const activeRoulettes = new Map(); // userId -> roulette data

// ═══════════════════════════════════════════════════════════
// EVENT: READY
// ═══════════════════════════════════════════════════════════
client.once('ready', async () => {
  console.log(`✅ البوت متصل! ${client.user.tag}`);
  console.log(`📊 عدد السيرفرات: ${client.guilds.cache.size}`);
  
  client.user.setActivity('🎮 /help للألعاب | /shop للمتجر', { type: ActivityType.Playing });
  
  // Register slash commands
  registerCommands();
});

// ═══════════════════════════════════════════════════════════
// SLASH COMMANDS REGISTRATION
// ═══════════════════════════════════════════════════════════
const slashCommands = [
  { name: 'help', description: 'عرض قائمة الألعاب المتاحة' },
  { name: 'profile', description: 'عرض ملفك الشخصي وإحصائياتك' },
  { name: 'balance', description: 'عرض رصيدك من العملات' },
  { name: 'daily', description: 'استلام المكافأة اليومية' },
  { name: 'shop', description: 'فتح المتجر' },
  { name: 'inventory', description: 'عرض حقيبتك' },
  { name: 'equip', description: 'تجهيز عنصر من حقيبتك', options: [{ name: 'item_name', description: 'اسم العنصر', type: 3, required: true }] },
  { name: 'dashboard', description: 'لوحة تحكم الإدارة', options: [{ name: 'action', description: 'الإجراء', type: 3, required: false, choices: [{ name: 'عرض', value: 'view' }, { name: 'إعدادات', value: 'settings' }, { name: 'ألعاب', value: 'games' }] }] },
  { name: 'roulette', description: 'لعبة الروليت - حاول حظك!' },
  { name: 'trivia', description: 'لعبة الأسئلة والأجوبة' },
  { name: 'blackjack', description: 'لعبة البلاك جاك (21)' },
  { name: 'slots', description: 'لعبة ماكينات الحظ (Slots)' },
  { name: 'dice', description: 'لعبة النرد' },
  { name: 'rps', description: 'لعبة حجرة ورقة مقص' },
  { name: 'word', description: 'لعبة تخمين الكلمة' },
  { name: 'math', description: 'لعبة الحساب السريع' },
  { name: 'memory', description: 'لعبة الذاكرة' },
  { name: 'fight', description: 'لعبة القتال - مبارزة!' },
  { name: 'coinflip', description: 'لعبة رمي العملة' },
  { name: 'snake', description: 'لعبة الثعبان النصية' },
];

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    
    const data = slashCommands.map(cmd => {
      const cmdData = {
        name: cmd.name,
        description: cmd.description,
        type: 1,
        options: [],
      };
      if (cmd.options) {
        for (const opt of cmd.options) {
          const optData = {
            name: opt.name,
            description: opt.description,
            type: opt.type,
            required: opt.required || false,
          };
          if (opt.choices) {
            optData.choices = opt.choices.map(c => ({ name: c.name, value: c.value }));
          }
          cmdData.options.push(optData);
        }
      }
      return cmdData;
    });

    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: data });
      console.log('✅ تم تسجيل الأوامر للسيرفر المحدد');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: data });
      console.log('✅ تم تسجيل الأوامر عالمياً');
    }
  } catch (error) {
    console.error('❌ خطأ في تسجيل الأوامر:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════
// MESSAGES EVENT - COMMAND HANDLER
// ═══════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  // Button interactions
  if (interaction.isButton()) {
    handleButtonInteraction(interaction);
    return;
  }
  
  // Select menu interactions
  if (interaction.isStringSelectMenu()) {
    handleSelectMenuInteraction(interaction);
    return;
  }
  
  // Modal interactions
  if (interaction.isModalSubmit()) {
    handleModalInteraction(interaction);
    return;
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  // Check maintenance mode (except for dashboard)
  if (getSetting('game_maintenance') === '1' && command !== 'dashboard') {
    return interaction.reply({
      embeds: [createEmbed('🔧 وضع الصيانة', 'الألعاب متوقفة حالياً للصيانة. يرجى المحاولة لاحقاً!', '#FF9900')],
      ephemeral: true
    });
  }

  // Handle commands
  switch (command) {
    case 'help': return handleHelp(interaction);
    case 'profile': return handleProfile(interaction);
    case 'balance': return handleBalance(interaction);
    case 'daily': return handleDaily(interaction);
    case 'shop': return handleShop(interaction);
    case 'inventory': return handleInventory(interaction);
    case 'equip': return handleEquip(interaction);
    case 'dashboard': return handleDashboard(interaction);
    case 'roulette': return handleRoulette(interaction);
    case 'trivia': return handleTrivia(interaction);
    case 'blackjack': return handleBlackjack(interaction);
    case 'slots': return handleSlots(interaction);
    case 'dice': return handleDice(interaction);
    case 'rps': return handleRPS(interaction);
    case 'word': return handleWord(interaction);
    case 'math': return handleMath(interaction);
    case 'memory': return handleMemory(interaction);
    case 'fight': return handleFight(interaction);
    case 'coinflip': return handleCoinflip(interaction);
    case 'snake': return handleSnake(interaction);
  }
});

// ═══════════════════════════════════════════════════════════
// HELPER: HELP MENU
// ═══════════════════════════════════════════════════════════
function handleHelp(interaction) {
  const embed = createEmbed(
    '🎮 قائمة الألعاب - Discord Games Bot',
    `**مرحباً بك في عالم الألعاب!** 🌟
اختر لعبة من القائمة أدناه وابدأ اللعب!

**🎰 ألعاب الحظ:**
🎯 \`/roulette\` - لعبة الروليت (سبن ويل)
🎰 \`/slots\` - ماكينات الحظ
🪙 \`/coinflip\` - رمي العملة
🎲 \`/dice\` - لعبة النرد

**🧠 ألعاب الذكاء:**
❓ \`/trivia\` - أسئلة وأجوبة
🔢 \`/math\` - حساب سريع
📝 \`/word\` - تخمين الكلمة
🧩 \`/memory\` - لعبة الذاكرة

**⚔️ ألعاب القتال والمغامرات:**
🥊 \`/fight\` - مبارزة قتالية
✂️ \`/rps\` - حجرة ورقة مقص
🐍 \`/snake\` - لعبة الثعبان
🃏 \`/blackjack\` - بلاك جاك (21)

**💼 نظامك:**
👤 \`/profile\` - ملفك الشخصي
💰 \`/balance\` - رصيدك
🎁 \`/daily\` - المكافأة اليومية
🛒 \`/shop\` - المتجر
🎒 \`/inventory\` - حقيبتك
⚙️ \`/dashboard\` - لوحة التحكم (للإدارة)`,
    '#5865F2'
  );
  
  embed.addFields(
    { name: '🏆 مستوى اللعبة', value: 'اربح العملات واكسب خبرة لترفع مستواك!', inline: true },
    { name: '🛡️ التجهيزات', value: 'اشترِ من المتجر وزِد قوتك في الألعاب!', inline: true }
  );

  interaction.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════
// HELPER: PROFILE
// ═══════════════════════════════════════════════════════════
function handleProfile(interaction) {
  const user = getUser(interaction.user.id);
  const embed = createEmbed(
    `👤 ملف ${interaction.user.username}`,
    '',
    '#5865F2'
  );
  
  const xpForNext = (user.level) * 500;
  const xpProgress = ((user.xp % 500) / 500 * 100).toFixed(0);
  const progressBar = '█'.repeat(Math.floor(xpProgress / 10)) + '░'.repeat(10 - Math.floor(xpProgress / 10));
  
  embed.addFields(
    { name: '🏆 المستوى', value: `${user.level}`, inline: true },
    { name: '⭐ الخبرة', value: `${user.xp}`, inline: true },
    { name: '📊 التقدم', value: `\`${progressBar}\` ${xpProgress}%`, inline: true },
    { name: '💰 العملات', value: formatCoins(user.coins), inline: true },
    { name: '⚔️ التجهيز', value: user.equipped || 'لا يوجد', inline: true },
    { name: '🏅 الفوز', value: `${user.wins}`, inline: true },
    { name: '❌ الخسارة', value: `${user.losses}`, inline: true },
    { name: '📈 نسبة الفوز', value: user.wins + user.losses > 0 ? `${((user.wins / (user.wins + user.losses)) * 100).toFixed(1)}%` : '0%', inline: true },
    { name: '📅 تاريخ الانضمام', value: `<t:${Math.floor(new Date(user.join_date).getTime() / 1000)}:R>`, inline: true }
  );
  
  embed.setThumbnail(interaction.user.displayAvatarURL());
  interaction.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════
// HELPER: BALANCE
// ═══════════════════════════════════════════════════════════
function handleBalance(interaction) {
  const user = getUser(interaction.user.id);
  interaction.reply({
    embeds: [createEmbed(
      `💰 رصيد ${interaction.user.username}`,
      `**رصيدك الحالي:** ${formatCoins(user.coins)}\n**مستواك:** ${user.level} ⭐`,
      '#FFD700'
    )]
  });
}

// ═══════════════════════════════════════════════════════════
// HELPER: DAILY BONUS
// ═══════════════════════════════════════════════════════════
function handleDaily(interaction) {
  const userId = interaction.user.id;
  const bonus = parseInt(getSetting('daily_bonus'));
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  let lastDaily = [];
  try { lastDaily = JSON.parse(getSetting('last_daily_check')); } catch(e) {}
  
  const lastClaim = lastDaily.find(d => d.userId === userId);
  if (lastClaim && lastClaim.date === today) {
    return interaction.reply({
      embeds: [createEmbed('⏰ مهلاً!', `لقد استلمت المكافأة اليومية اليوم بالفعل! عد غداً 🌙`, '#FF9900')],
      ephemeral: true
    });
  }
  
  updateCoins(userId, bonus);
  const lvlResult = updateXP(userId, Math.floor(bonus / 2));
  
  lastDaily = lastDaily.filter(d => d.userId !== userId);
  lastDaily.push({ userId, date: today });
  setSetting('last_daily_check', JSON.stringify(lastDaily));
  
  interaction.reply({
    embeds: [createEmbed(
      '🎁 المكافأة اليومية!',
      `**لقد استلمت:** ${formatCoins(bonus)}\n**XP:** +${Math.floor(bonus / 2)} ⭐\n${lvlResult.leveledUp ? `\n🎉 تهانينا! وصلت للمستوى ${lvlResult.newLevel}!` : ''}`,
      '#00FF00'
    )]
  });
}

// ═══════════════════════════════════════════════════════════
// HELPER: SHOP
// ═══════════════════════════════════════════════════════════
function handleShop(interaction) {
  const user = getUser(interaction.user.id);
  const items = db.prepare('SELECT * FROM shop_items WHERE active = 1').all();
  
  if (items.length === 0) {
    return interaction.reply({ embeds: [createEmbed('🛒 المتجر', 'المتجر فارغ حالياً!', '#FF9900')] });
  }
  
  const embed = createEmbed('🛒 المتجر - اختَر ما تريد!', `💰 رصيدك: ${formatCoins(user.coins)}`, '#FF6B6B');
  
  items.forEach((item, index) => {
    embed.addFields({
      name: `${item.emoji} ${item.name} - ${formatCoins(item.price)}`,
      value: `${item.description}\n📂 الفئة: \`${item.category}\``,
      inline: true
    });
  });
  
  const buttons = items.slice(0, 5).map((item, index) =>
    new ButtonBuilder()
      .setCustomId(`shop_buy_${item.id}`)
      .setLabel(`${item.emoji} ${item.name}`)
      .setStyle(ButtonStyle.Primary)
  );
  
  if (buttons.length === 0) buttons.push(new ButtonBuilder().setCustomId('shop_none').setLabel('لا يوجد عناصر').setStyle(ButtonStyle.Secondary).setDisabled(true));
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// HELPER: INVENTORY
// ═══════════════════════════════════════════════════════════
function handleInventory(interaction) {
  const user = getUser(interaction.user.id);
  let inventory;
  try { inventory = JSON.parse(user.inventory); } catch(e) { inventory = []; }
  
  if (inventory.length === 0) {
    return interaction.reply({
      embeds: [createEmbed('🎒 حقيبة فارغة', 'لم تشتري أي شيء بعد! اذهب للمتجر 🛒', '#FF9900')]
    });
  }
  
  const embed = createEmbed('🎒 حقيبة物品的ك', `⚔️ المجهز: ${user.equipped || 'لا يوجد'}`, '#9B59B6');
  
  inventory.forEach(itemName => {
    embed.addFields({ name: itemName, value: '📦 في الحقيبة', inline: true });
  });
  
  interaction.reply({ embeds: [embed] });
}

// ═══════════════════════════════════════════════════════════
// HELPER: EQUIP
// ═══════════════════════════════════════════════════════════
function handleEquip(interaction) {
  const user = getUser(interaction.user.id);
  let inventory;
  try { inventory = JSON.parse(user.inventory); } catch(e) { inventory = []; }
  
  const itemName = interaction.options.getString('item_name');
  const found = inventory.find(i => i.toLowerCase() === itemName.toLowerCase());
  
  if (!found) {
    return interaction.reply({
      embeds: [createEmbed('❌ خطأ', `لا تملك هذا العنصر: ${itemName}`, '#FF0000')],
      ephemeral: true
    });
  }
  
  db.prepare('UPDATE users SET equipped = ? WHERE id = ?').run(found, interaction.user.id);
  
  interaction.reply({
    embeds: [createEmbed('⚔️ تم التجهيز!', `لقد قمت بتجهيز: **${found}** ${user.equipped !== found ? '✅' : '🔄'}`, '#00FF00')]
  });
}

// ═══════════════════════════════════════════════════════════
// HELPER: DASHBOARD
// ═══════════════════════════════════════════════════════════
function handleDashboard(interaction) {
  const isAdmin = ADMIN_IDS.includes(interaction.user.id) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  
  if (!isAdmin) {
    return interaction.reply({
      embeds: [createEmbed('🔒 وصول مرفوض', 'هذا الأمر محجوز للمسؤولين فقط!', '#FF0000')],
      ephemeral: true
    });
  }
  
  const action = interaction.options.getString('action') || 'view';
  
  if (action === 'settings') {
    return handleDashboardSettings(interaction);
  }
  
  if (action === 'games') {
    return handleDashboardGames(interaction);
  }
  
  // Default: view
  const settings = db.prepare('SELECT * FROM settings').all();
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalShop = db.prepare('SELECT COUNT(*) as count FROM shop_items').get().count;
  const maintenance = getSetting('game_maintenance') === '1' ? '🔧 مفعل' : '✅ غير مفعل';
  
  const embed = createEmbed(
    '⚙️ لوحة التحكم - Dashboard',
    `**مرحباً بالمسؤول!** 👑\nهذه لوحة التحكم الرئيسية للبوت.`,
    '#1ABC9C'
  );
  
  embed.addFields(
    { name: '👥 إجمالي المستخدمين', value: totalUsers.toString(), inline: true },
    { name: '🛒 عناصر المتجر', value: totalShop.toString(), inline: true },
    { name: '🔧 وضع الصيانة', value: maintenance, inline: true },
    { name: '💰 المكافأة اليومية', value: formatCoins(parseInt(getSetting('daily_bonus'))), inline: true },
    { name: '🎯 عملات الفوز', value: formatCoins(parseInt(getSetting('coins_per_win'))), inline: true },
    { name: '⭐ XP الفوز', value: getSetting('xp_per_win'), inline: true },
    { name: '📉 أقل رهان', value: formatCoins(parseInt(getSetting('min_bet'))), inline: true },
    { name: '📈 أعلى رهان', value: formatCoins(parseInt(getSetting('max_bet'))), inline: true }
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId('dash_settings').setLabel('⚙️ إعدادات').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_games').setLabel('🎮 الألعاب').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_shop').setLabel('🛒 المتجر').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('dash_maintenance').setLabel('🔧 صيانة').setStyle(
      getSetting('game_maintenance') === '1' ? ButtonStyle.Danger : ButtonStyle.Secondary
    ),
    new ButtonBuilder().setCustomId('dash_add_item').setLabel('➕ إضافة متجر').setStyle(ButtonStyle.Primary),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function handleDashboardSettings(interaction) {
  const isAdmin = ADMIN_IDS.includes(interaction.user.id) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) return;
  
  const embed = createEmbed('⚙️ إعدادات الداشبورد', 'اختر الإعداد لتعديله:', '#1ABC9C');
  embed.addFields(
    { name: '💰 عملات الفوز', value: getSetting('coins_per_win'), inline: true },
    { name: '⭐ XP الفوز', value: getSetting('xp_per_win'), inline: true },
    { name: '🎁 مكافأة يومية', value: getSetting('daily_bonus'), inline: true },
    { name: '📉 أقل رهان', value: getSetting('min_bet'), inline: true },
    { name: '📈 أعلى رهان', value: getSetting('max_bet'), inline: true },
    { name: '🎯 دورات الروليت', value: getSetting('roulette_spins'), inline: true }
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId('dash_edit_coins').setLabel('💰 عملات').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_edit_xp').setLabel('⭐ XP').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_edit_daily').setLabel('🎁 يومي').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_edit_minbet').setLabel('📉 أقل').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_edit_maxbet').setLabel('📈 أعلى').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_edit_spins').setLabel('🎯 دورات').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_back').setLabel('↩️ رجوع').setStyle(ButtonStyle.Danger),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function handleDashboardGames(interaction) {
  const isAdmin = ADMIN_IDS.includes(interaction.user.id) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) return;
  
  const maintenance = getSetting('game_maintenance') === '1';
  
  const embed = createEmbed('🎮 إدارة الألعاب', 'تحكم في الألعاب من هنا:', '#1ABC9C');
  embed.addFields(
    { name: '🔧 وضع الصيانة', value: maintenance ? '🔴 مفعل - الألعاب متوقفة' : '🟢 غير مفعل - الألعاب تعمل', inline: true },
    { name: '👁️ عدد الألعاب', value: '12 لعبة نشطة', inline: true },
    { name: '🎯 ألعاب الحظ', value: 'roulette, slots, coinflip, dice', inline: true },
    { name: '🧠 ألعاب الذكاء', value: 'trivia, math, word, memory', inline: true },
    { name: '⚔️ ألعاب القتال', value: 'fight, rps, snake, blackjack', inline: true }
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId(`dash_toggle_maint`).setLabel(maintenance ? '✅ إيقاف الصيانة' : '🔧 تفعيل الصيانة').setStyle(maintenance ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('dash_stats').setLabel('📊 إحصائيات').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_back').setLabel('↩️ رجوع').setStyle(ButtonStyle.Secondary),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// ROULETTE GAME
// ═══════════════════════════════════════════════════════════
function handleRoulette(interaction) {
  const user = getUser(interaction.user.id);
  const minBet = parseInt(getSetting('min_bet'));
  const maxBet = parseInt(getSetting('max_bet'));
  
  const embed = createEmbed('🎰 لعبة الروليت - Roulette', 
    `💰 رصيدك: ${formatCoins(user.coins)}\n📉 أقل رهان: ${formatCoins(minBet)}\n📈 أعلى رهان: ${formatCoins(maxBet)}\n\n**اختر مكان رهانك!**`,
    '#E74C3C'
  );
  
  embed.addFields(
    { name: '🔴 أحمر (x2)', value: 'احتمال 47%', inline: true },
    { name: '⚫ أسود (x2)', value: 'احتمال 47%', inline: true },
    { name: '🟢 أخضر (x14)', value: 'احتمال 6%', inline: true },
    { name: '🔢 رقم (x36)', value: '0-36', inline: true },
    { name: '⚖️ زوجي/فردي (x2)', value: '50/50', inline: true },
    { name: '📊 عالي/منخفض (x2)', value: '1-18 / 19-36', inline: true }
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId('roulette_red').setLabel('🔴 أحمر').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('roulette_black').setLabel('⚫ أسود').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('roulette_green').setLabel('🟢 أخضر').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('roulette_even').setLabel('⚖️ زوجي').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('roulette_odd').setLabel('🎲 فردي').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('roulette_low').setLabel('📉 1-18').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('roulette_high').setLabel('📈 19-36').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('roulette_number').setLabel('🔢 رقم').setStyle(ButtonStyle.Primary),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function spinRoulette(betType, betValue, betAmount, userId) {
  const numbers = Array.from({ length: 37 }, (_, i) => i); // 0-36
  const result = numbers[Math.floor(Math.random() * numbers.length)];
  
  let won = false;
  let multiplier = 0;
  
  switch (betType) {
    case 'red':
      won = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(result);
      multiplier = 2;
      break;
    case 'black':
      won = [2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35].includes(result);
      multiplier = 2;
      break;
    case 'green':
      won = result === 0;
      multiplier = 14;
      break;
    case 'number':
      won = result === betValue;
      multiplier = 36;
      break;
    case 'even':
      won = result !== 0 && result % 2 === 0;
      multiplier = 2;
      break;
    case 'odd':
      won = result % 2 === 1;
      multiplier = 2;
      break;
    case 'low':
      won = result >= 1 && result <= 18;
      multiplier = 2;
      break;
    case 'high':
      won = result >= 19 && result <= 36;
      multiplier = 2;
      break;
  }
  
  const winnings = won ? betAmount * multiplier : 0;
  
  // Record history
  db.prepare('INSERT INTO roulette_history (user_id, bet_amount, result, won) VALUES (?, ?, ?, ?)')
    .run(userId, betAmount, result, won ? 1 : 0);
  
  return { result, won, winnings, multiplier };
}

function createRouletteVisual(result, color) {
  const redNums = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  const numColor = result === 0 ? '🟢' : redNums.includes(result) ? '🔴' : '⚫';
  return `${numColor} الرقم: **${result}**`;
}

// ═══════════════════════════════════════════════════════════
// TRIVIA GAME
// ═══════════════════════════════════════════════════════════
const triviaQuestions = [
  { q: 'ما هي عاصمة اليابان؟', a: 'طوكيو', options: ['طوكيو', 'بكين', 'سيول', 'بانكوك'] },
  { q: 'كم عدد كواكب المجموعة الشمسية؟', a: '8', options: ['7', '8', '9', '10'] },
  { q: 'ما هو أكبر محيط في العالم؟', a: 'الهادي', options: ['الأطلسي', 'الهندي', 'الهادي', 'المتجمد'] },
  { q: 'من اخترع المصباح الكهربائي؟', a: 'إديسون', options: ['تسلا', 'إديسون', 'بيل', 'نيوتن'] },
  { q: 'ما هي أكبر دولة في العالم مساحة؟', a: 'روسيا', options: ['الصين', 'الولايات المتحدة', 'روسيا', 'كندا'] },
  { q: 'كم عدد أسنان الإنسان البالغ؟', a: '32', options: ['28', '30', '32', '36'] },
  { q: 'ما هو أسرع حيوان في العالم؟', a: 'الفهد', options: ['الأسد', 'الفهد', 'النمر', 'الذئب'] },
  { q: 'ما هي أطول نهر في العالم؟', a: 'النيل', options: ['النيل', 'الأمازون', 'الفرات', 'اليانغتسي'] },
  { q: 'في أي سنة انتهت الحرب العالمية الثانية؟', a: '1945', options: ['1943', '1944', '1945', '1946'] },
  { q: 'ما هو العنصر الكيميائي الذي رمزه O؟', a: 'الأكسجين', options: ['الأكسجين', 'الذهب', 'الفضة', 'الحديد'] },
  { q: 'كم عدد أيام السنة الكبيسة؟', a: '366', options: ['364', '365', '366', '367'] },
  { q: 'ما هي عاصمة أستراليا؟', a: 'كانبرا', options: ['سيدني', 'ملبورن', 'كانبرا', 'بيرث'] },
  { q: 'كم عدد ألوان قوس قزح؟', a: '7', options: ['5', '6', '7', '8'] },
  { q: 'ما هو أثقل عنصر طبيعي؟', a: 'اليورانيوم', options: ['الرصاص', 'الذهب', 'اليورانيوم', 'البلاتين'] },
  { q: 'من هو مؤسس شركة مايكروسوفت؟', a: 'بيل غيتس', options: ['جوبز', 'بيل غيتس', 'زوكربيرغ', 'ماسك'] },
  { q: 'ما هي عاصمة البرازيل؟', a: 'برازيليا', options: ['ريو', 'ساو باولو', 'برازيليا', 'بوينس آيرس'] },
  { q: 'كم عدد عضلات جسم الإنسان؟', a: '600+', options: ['300', '400', '500', '600+'] },
  { q: 'ما هو الكوكب الأقرب للشمس؟', a: 'عطارد', options: ['الزهرة', 'عطارد', 'الأرض', 'المريخ'] },
  { q: 'في أي قارة تقع مصر؟', a: 'أفريقيا', options: ['آسيا', 'أفريقيا', 'أوروبا', 'أمريكا'] },
  { q: 'ما هي لغة البرمجة التي طورتها جايمس غوسلينغ؟', a: 'Java', options: ['Python', 'Java', 'C++', 'Ruby'] },
];

function handleTrivia(interaction) {
  const question = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
  const coinsPerWin = parseInt(getSetting('coins_per_win'));
  const xpPerWin = parseInt(getSetting('xp_per_win'));
  
  const embed = createEmbed('❓ لعبة الأسئلة والأجوبة - Trivia', `💰 الفوز: +${formatCoins(coinsPerWin)}\n⭐ XP: +${xpPerWin}\n\n**${question.q}**`, '#3498DB');
  
  // Shuffle options
  const shuffled = question.options.sort(() => Math.random() - 0.5);
  const buttons = shuffled.map(opt =>
    new ButtonBuilder()
      .setCustomId(`trivia_${opt}`)
      .setLabel(opt)
      .setStyle(ButtonStyle.Primary)
  );
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// BLACKJACK GAME
// ═══════════════════════════════════════════════════════════
const blackjackSuits = ['♠️', '♥️', '♦️', '♣️'];
const blackjackValues = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createBlackjackDeck() {
  const deck = [];
  for (const suit of blackjackSuits) {
    for (const value of blackjackValues) {
      deck.push({ suit, value });
    }
  }
  return shuffleArray(deck);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.value)) return 10;
  if (card.value === 'A') return 11;
  return parseInt(card.value);
}

function handTotal(hand) {
  let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = hand.filter(c => c.value === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function cardToString(card) {
  const color = (card.suit === '♥️' || card.suit === '♦️') ? '' : '';
  return `${card.value}${card.suit}`;
}

function handleBlackjack(interaction) {
  const user = getUser(interaction.user.id);
  const minBet = parseInt(getSetting('min_bet'));
  const maxBet = parseInt(getSetting('max_bet'));
  
  const embed = createEmbed('🃏 بلاك جاك - Blackjack', 
    `💰 رصيدك: ${formatCoins(user.coins)}\n📉 أقل رهان: ${formatCoins(minBet)}\n📈 أعلى رهان: ${formatCoins(maxBet)}\n\n**ادخل مبلغ رهانك!**`,
    '#2ECC71'
  );
  
  const modal = new ModalBuilder()
    .setCustomId('blackjack_bet')
    .setTitle('💰 أدخل مبلغ الرهان');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('bet_amount')
        .setLabel('مبلغ الرهان')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`بين ${minBet} و ${maxBet}`)
        .setRequired(true)
        .setMaxLength(5)
    )
  );
  
  interaction.showModal(modal);
}

function startBlackjackGame(interaction, betAmount) {
  const userId = interaction.user.id;
  const deck = createBlackjackDeck();
  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];
  
  const gameData = {
    deck,
    playerHand,
    dealerHand,
    betAmount,
    userId,
    channelId: interaction.channelId,
    messageId: null,
  };
  
  activeGames.set(`${userId}_blackjack`, gameData);
  
  updateBlackjackDisplay(interaction, gameData, false);
}

function updateBlackjackDisplay(interaction, gameData, dealerReveal) {
  const { playerHand, dealerHand, betAmount } = gameData;
  const user = getUser(interaction.userId || interaction.user.id);
  
  let dealerCards = dealerHand.map(cardToString).join(' ');
  if (!dealerReveal) {
    dealerCards = cardToString(dealerHand[0]) + ' 🂠';
  }
  
  const embed = createEmbed(
    '🃏 بلاك جاك - Blackjack',
    `💰 رهانك: ${formatCoins(betAmount)}\n\n**الموزع:** ${dealerCards}\n🔢 المجموع: ${dealerReveal ? handTotal(dealerHand) : cardValue(dealerHand[0])}\n\n**أنت:** ${playerHand.map(cardToString).join(' ')}\n🔢 المجموع: ${handTotal(playerHand)}`,
    handTotal(playerHand) === 21 ? '#FFD700' : '#2ECC71'
  );
  
  if (handTotal(playerHand) === 21) {
    embed.setDescription(embed.data.description + '\n\n🎉 **بلاك جاك!**');
  }
  
  const buttons = dealerReveal ? [] : [
    new ButtonBuilder().setCustomId('bj_hit').setLabel('🃏 سحب').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('✋ وقف').setStyle(ButtonStyle.Secondary),
  ];
  
  const row = buttons.length > 0 ? createButtons(...buttons) : null;
  
  if (interaction.replied || interaction.deferred) {
    return;
  }
  
  if (buttons.length === 0) {
    return interaction.reply({ embeds: [embed] });
  }
  
  return interaction.reply({ embeds: [embed], components: [row] });
}

// ═══════════════════════════════════════════════════════════
// SLOTS GAME
// ═══════════════════════════════════════════════════════════
const slotSymbols = ['🍒', '🍋', '🍇', '🍊', '🍉', '⭐', '💎', '7️⃣', '🔔', '🍀'];

function handleSlots(interaction) {
  const user = getUser(interaction.user.id);
  const minBet = parseInt(getSetting('min_bet'));
  const maxBet = parseInt(getSetting('max_bet'));
  
  const embed = createEmbed('🎰 ماكينات الحظ - Slots', 
    `💰 رصيدك: ${formatCoins(user.coins)}\n\n**اختر مبلغ رهانك!**`,
    '#E67E22'
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId(`slots_${minBet}`).setLabel(`${formatCoins(minBet)}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`slots_${Math.min(minBet * 5, maxBet)}`).setLabel(formatCoins(Math.min(minBet * 5, maxBet))).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`slots_${Math.min(minBet * 10, maxBet)}`).setLabel(formatCoins(Math.min(minBet * 10, maxBet))).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`slots_${maxBet}`).setLabel(`${formatCoins(maxBet)}`).setStyle(ButtonStyle.Danger),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function spinSlots(betAmount, userId) {
  const spin1 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
  const spin2 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
  const spin3 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
  
  let won = false;
  let multiplier = 0;
  let message = '';
  
  if (spin1 === spin2 && spin2 === spin3) {
    won = true;
    multiplier = spin1 === '7️⃣' ? 50 : spin1 === '💎' ? 25 : 10;
    message = '🎉 JACKPOT! ثلاثة متطابقة!';
  } else if (spin1 === spin2 || spin2 === spin3 || spin1 === spin3) {
    won = true;
    multiplier = 2;
    message = '✨ زوج متطابق!';
  } else {
    message = '😔 حظ أوفر في المرة القادمة!';
  }
  
  const winnings = won ? betAmount * multiplier : 0;
  const result = `\n${spin1} | ${spin2} | ${spin3}\n`;
  
  return { result, won, winnings, multiplier, message };
}

// ═══════════════════════════════════════════════════════════
// DICE GAME
// ═══════════════════════════════════════════════════════════
function handleDice(interaction) {
  const user = getUser(interaction.user.id);
  const minBet = parseInt(getSetting('min_bet'));
  const maxBet = parseInt(getSetting('max_bet'));
  
  const embed = createEmbed('🎲 لعبة النرد - Dice', 
    `💰 رصيدك: ${formatCoins(user.coins)}\n\n**الرهان على المجموع:**\n📉 منخفض (2-6) x2\n⚖️ وسط (7) x5\n📈 عالي (8-12) x2\n🎯 رقم محدد x6`,
    '#9B59B6'
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId('dice_low').setLabel('📉 2-6').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dice_middle').setLabel('⚖️ 7').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dice_high').setLabel('📈 8-12').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dice_bet').setLabel('💰 حدد الرهان').setStyle(ButtonStyle.Success),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function rollDice() {
  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  const total = die1 + die2;
  return { die1, die2, total };
}

// ═══════════════════════════════════════════════════════════
// ROCK PAPER SCISSORS
// ═══════════════════════════════════════════════════════════
function handleRPS(interaction) {
  const user = getUser(interaction.user.id);
  const coinsPerWin = parseInt(getSetting('coins_per_win'));
  const xpPerWin = parseInt(getSetting('xp_per_win'));
  
  const embed = createEmbed('✂️ حجرة ورقة مقص - Rock Paper Scissors', 
    `💰 الفوز: +${formatCoins(coinsPerWin)}\n⭐ XP: +${xpPerWin}\n\n**اختر!**`,
    '#F39C12'
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId('rps_rock').setLabel('🪨 حجرة').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rps_paper').setLabel('📄 ورقة').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rps_scissors').setLabel('✂️ مقص').setStyle(ButtonStyle.Primary),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// WORD GUESS GAME
// ═══════════════════════════════════════════════════════════
const wordList = [
  { word: 'حاسوب', hint: 'جهاز إلكتروني نستخدمه يومياً' },
  { word: 'شمس', hint: 'نجم يضيء الأرض' },
  { word: 'بحر', hint: 'مسطح مائي كبير وملح' },
  { word: 'جبل', hint: 'أرض مرتفعة جداً' },
  { word: 'نهر', hint: 'ماء يتدفق من مكان عالٍ' },
  { word: 'كتاب', hint: 'نقرأ فيه المعلومات' },
  { word: 'مدرسة', hint: 'نذهب إليها للتعلم' },
  { word: 'طائرة', hint: 'تطير في السماء' },
  { word: 'سفينة', hint: 'تبحر في الماء' },
  { word: 'قمر', hint: 'يظهر في السماء ليلاً' },
  { word: 'نار', hint: 'حارة وتضيء' },
  { word: 'ثلج', hint: 'أبيض وبارد يسقط من السماء' },
  { word: 'غابة', hint: 'مكان فيه الكثير من الأشجار' },
  { word: 'صحراء', hint: 'مكان حار وجاف' },
  { word: 'مطعم', hint: 'نذهب إليه للأكل' },
];

function handleWord(interaction) {
  const coinEntry = 50;
  const user = getUser(interaction.user.id);
  const coinsPerWin = parseInt(getSetting('coins_per_win'));
  const xpPerWin = parseInt(getSetting('xp_per_win'));
  
  if (user.coins < coinEntry) {
    return interaction.reply({
      embeds: [createEmbed('❌ رصيد غير كافٍ', `تحتاج ${formatCoins(coinEntry)} للعب!`, '#FF0000')],
      ephemeral: true
    });
  }
  
  updateCoins(interaction.user.id, -coinEntry);
  
  const gameData = wordList[Math.floor(Math.random() * wordList.length)];
  const masked = '_ '.repeat(gameData.word.length);
  
  const embed = createEmbed('📝 تخمين الكلمة - Word Guess', 
    `💰 تكلفة الدخول: ${formatCoins(coinEntry)}\n💰 الفوز: +${formatCoins(coinsPerWin + coinEntry)}\n⭐ XP: +${xpPerWin}\n\n**${masked}**\n\n💡 تلميح: ${gameData.hint}\n\n**أدخل إجابتك!**`,
    '#1ABC9C'
  );
  
  const modal = new ModalBuilder()
    .setCustomId('word_guess')
    .setTitle('📝 أدخل إجابتك');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('guess')
        .setLabel('الكلمة')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
    )
  );
  
  activeGames.set(`${interaction.user.id}_word`, { word: gameData.word, entry: coinEntry });
  interaction.showModal(modal);
}

// ═══════════════════════════════════════════════════════════
// MATH GAME
// ═══════════════════════════════════════════════════════════
function generateMathQuestion() {
  const operations = ['+', '-', '*'];
  const op = operations[Math.floor(Math.random() * operations.length)];
  let a, b, answer;
  
  switch (op) {
    case '+':
      a = Math.floor(Math.random() * 100) + 1;
      b = Math.floor(Math.random() * 100) + 1;
      answer = a + b;
      break;
    case '-':
      a = Math.floor(Math.random() * 100) + 1;
      b = Math.floor(Math.random() * a) + 1;
      answer = a - b;
      break;
    case '*':
      a = Math.floor(Math.random() * 20) + 1;
      b = Math.floor(Math.random() * 20) + 1;
      answer = a * b;
      break;
  }
  
  const symbol = op === '*' ? '×' : op === '-' ? '-' : '+';
  return { question: `${a} ${symbol} ${b} = ?`, answer: answer.toString() };
}

function handleMath(interaction) {
  const question = generateMathQuestion();
  const coinsPerWin = parseInt(getSetting('coins_per_win'));
  const xpPerWin = parseInt(getSetting('xp_per_win'));
  
  // Generate wrong answers
  const wrong1 = (question.answer * 1 + Math.floor(Math.random() * 10) + 1).toString();
  const wrong2 = (question.answer * 1 - Math.floor(Math.random() * 10) - 1).toString();
  const wrong3 = (question.answer * 1 + Math.floor(Math.random() * 20) - 5).toString();
  
  const options = [question.answer, wrong1, wrong2, wrong3].sort(() => Math.random() - 0.5);
  
  const embed = createEmbed('🔢 الحساب السريع - Math', 
    `💰 الفوز: +${formatCoins(coinsPerWin)}\n⭐ XP: +${xpPerWin}\n\n**${question.question}**`,
    '#3498DB'
  );
  
  activeGames.set(`${interaction.user.id}_math`, { answer: question.answer });
  
  const buttons = options.map(opt =>
    new ButtonBuilder()
      .setCustomId(`math_${opt}`)
      .setLabel(opt)
      .setStyle(ButtonStyle.Primary)
  );
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// MEMORY GAME
// ═══════════════════════════════════════════════════════════
const memoryEmojiSets = ['🍎🍊🍇🍉🍓🥝', '🐶🐱🐭🐹🐰🦊', '⚽🏀🏈⚾🎾🏐', '🌹🌸🌺🌻🌼🌷', '🚗✈️🚀🚁🚂🛸'];

function handleMemory(interaction) {
  const coinsPerWin = parseInt(getSetting('coins_per_win'));
  const xpPerWin = parseInt(getSetting('xp_per_win'));
  
  // Select 6 emojis and double them
  const set = memoryEmojiSets[Math.floor(Math.random() * memoryEmojiSets.length)];
  const emojis = set.match(/.{1,2}/g) || [];
  const cards = [...emojis, ...emojis];
  shuffleArray(cards);
  
  const hiddenBoard = cards.map(() => '❓').join(' ');
  const revealedBoard = cards.join(' ');
  
  const embed = createEmbed('🧩 لعبة الذاكرة - Memory', 
    `💰 الفوز: +${formatCoins(coinsPerWin)}\n⭐ XP: +${xpPerWin}\n\n**اللوحة:**\n\`${hiddenBoard}\`\n\n**الإجابة (المخفية):**\n\`\`\`${revealedBoard}\`\`\`\n\n**اختر رقم البطاقة (1-12)!**`,
    '#9B59B6'
  );
  
  activeGames.set(`${interaction.user.id}_memory`, { cards });
  
  interaction.reply({ embeds: [embed], components: [] });
  
  // Send a follow-up modal for choosing
  const modal = new ModalBuilder()
    .setCustomId('memory_pick')
    .setTitle('🧩 اختر بطاقتك');
  
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('pick_number')
        .setLabel('رقم البطاقة (1-12)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('أدخل رقم بين 1 و 12')
        .setRequired(true)
        .setMaxLength(2)
    )
  );
  
  interaction.followUp({ components: [], content: '⏳ اختر رقم البطاقة...' });
  
  // Simple version: just ask the user to pick via modal
  interaction.followUp({ components: [], ephemeral: true });
}

// ═══════════════════════════════════════════════════════════
// FIGHT GAME
// ═══════════════════════════════════════════════════════════
const fightOpponents = [
  { name: 'غول صغير', emoji: '👹', hp: 50, attack: 5 },
  { name: 'ذئب برّي', emoji: '🐺', hp: 60, attack: 8 },
  { name: 'تنين صغير', emoji: '🐉', hp: 80, attack: 12 },
  { name: 'محارب شجاع', emoji: '⚔️', hp: 100, attack: 15 },
  { name: 'ملك الظلام', emoji: '👑', hp: 150, attack: 20 },
  { name: 'وحش الأساطير', emoji: '🐲', hp: 200, attack: 25 },
];

function handleFight(interaction) {
  const coinEntry = 100;
  const user = getUser(interaction.user.id);
  const coinsPerWin = parseInt(getSetting('coins_per_win'));
  
  if (user.coins < coinEntry) {
    return interaction.reply({
      embeds: [createEmbed('❌ رصيد غير كافٍ', `تحتاج ${formatCoins(coinEntry)} للمبارزة!`, '#FF0000')],
      ephemeral: true
    });
  }
  
  updateCoins(interaction.user.id, -coinEntry);
  
  const opponent = fightOpponents[Math.floor(Math.random() * fightOpponents.length)];
  let playerHP = 100 + (user.level * 10);
  let opponentHP = opponent.hp;
  const playerAttack = 10 + (user.level * 3);
  const equipped = user.equipped || '';
  const equippedBonus = equipped.includes('سيف') ? 10 : equipped.includes('عصا') ? 8 : equipped.includes('بطلقة') ? 5 : 0;
  
  const embed = createEmbed('⚔️ مبارزة قتالية - Fight!', 
    `💰 تكلفة: ${formatCoins(coinEntry)} | الفوز: +${formatCoins(coinsPerWin + coinEntry)}\n\n**${interaction.user.username}** ❤️ ${playerHP}/${playerHP} | ⚔️ ${playerAttack + equippedBonus}\n**${opponent.emoji} ${opponent.name}** ❤️ ${opponentHP}/${opponentHP} | ⚔️ ${opponent.attack}`,
    '#E74C3C'
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId('fight_attack').setLabel('⚔️ هجوم').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('fight_defend').setLabel('🛡️ دفاع').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('fight_special').setLabel('✨ هجوم خاص').setStyle(ButtonStyle.Secondary),
  ];
  
  activeGames.set(`${interaction.user.id}_fight`, {
    playerHP, opponentHP, playerAttack: playerAttack + equippedBonus, opponentAttack: opponent.attack,
    opponentName: opponent.name, opponentEmoji: opponent.emoji, log: []
  });
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// COIN FLIP GAME
// ═══════════════════════════════════════════════════════════
function handleCoinflip(interaction) {
  const user = getUser(interaction.user.id);
  const minBet = parseInt(getSetting('min_bet'));
  const maxBet = parseInt(getSetting('max_bet'));
  
  const embed = createEmbed('🪙 رمي العملة - Coin Flip', 
    `💰 رصيدك: ${formatCoins(user.coins)}\n📉 أقل رهان: ${formatCoins(minBet)}\n📈 أعلى رهان: ${formatCoins(maxBet)}\n\n**اختر وجه العملة!**`,
    '#F1C40F'
  );
  
  const buttons = [
    new ButtonBuilder().setCustomId('coin_heads').setLabel('👑 وجه (Heads)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('coin_tails').setLabel('🪙 صورة (Tails)').setStyle(ButtonStyle.Primary),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// SNAKE GAME (TEXT VERSION)
// ═══════════════════════════════════════════════════════════
function handleSnake(interaction) {
  const user = getUser(interaction.user.id);
  const coinsPerWin = parseInt(getSetting('coins_per_win'));
  
  const embed = createEmbed('🐍 لعبة الثعبان - Snake', 
    `💰 الفوز: +${formatCoins(coinsPerWin)}\n\n**استخدم الأزرار للتحكم بالثعبان!**\n🍎 كل التفاحة ليزيد طول الثعبان!\n⚠️ لا تصطدم بالجدران أو بنفسك!`,
    '#27AE60'
  );
  
  // Initialize game
  const gridSize = 7;
  const snake = [[3, 3], [3, 2], [3, 1]];
  const food = [Math.floor(Math.random() * gridSize), Math.floor(Math.random() * gridSize)];
  let direction = 'right';
  let score = 0;
  
  activeGames.set(`${interaction.user.id}_snake`, { gridSize, snake, food, direction, score });
  
  const snakeBoard = renderSnakeBoard(gridSize, snake, food);
  embed.setDescription(embed.data.description + `\n\n\`\`\`\n${snakeBoard}\`\`\`\n**النتيجة: ${score}**`);
  
  const buttons = [
    new ButtonBuilder().setCustomId('snake_up').setLabel('⬆️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('snake_left').setLabel('⬅️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('snake_right').setLabel('➡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('snake_down').setLabel('⬇️').setStyle(ButtonStyle.Primary),
  ];
  
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function renderSnakeBoard(gridSize, snake, food) {
  let board = '';
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (snake[0][0] === x && snake[0][1] === y) {
        board += '🐍';
      } else if (food[0] === x && food[1] === y) {
        board += '🍎';
      } else if (snake.some(s => s[0] === x && s[1] === y)) {
        board += '🟩';
      } else {
        board += '⬜';
      }
    }
    board += '\n';
  }
  return board;
}

// ═══════════════════════════════════════════════════════════
// BUTTON INTERACTION HANDLER
// ═══════════════════════════════════════════════════════════
async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;
  
  // ─── SHOP BUTTONS ───
  if (customId.startsWith('shop_buy_')) {
    const itemId = parseInt(customId.replace('shop_buy_', ''));
    const item = db.prepare('SELECT * FROM shop_items WHERE id = ? AND active = 1').get(itemId);
    
    if (!item) {
      return interaction.reply({ embeds: [createEmbed('❌ خطأ', 'هذا العنصر غير موجود!', '#FF0000')], ephemeral: true });
    }
    
    const user = getUser(interaction.user.id);
    if (user.coins < item.price) {
      return interaction.reply({ embeds: [createEmbed('❌ رصيد غير كافٍ', `تحتاج ${formatCoins(item.price)} ولديك ${formatCoins(user.coins)}`, '#FF0000')], ephemeral: true });
    }
    
    updateCoins(interaction.user.id, -item.price);
    let inventory;
    try { inventory = JSON.parse(user.inventory); } catch(e) { inventory = []; }
    inventory.push(item.name);
    db.prepare('UPDATE users SET inventory = ? WHERE id = ?').run(JSON.stringify(inventory), interaction.user.id);
    
    interaction.reply({ embeds: [createEmbed('🛒 تم الشراء!', `اشتريت: ${item.emoji} **${item.name}**\n💰 الخصم: ${formatCoins(item.price)}`, '#00FF00')] });
    return;
  }
  
  // ─── ROULETTE BUTTONS ───
  if (customId.startsWith('roulette_')) {
    const betType = customId.replace('roulette_', '');
    const minBet = parseInt(getSetting('min_bet'));
    const maxBet = parseInt(getSetting('max_bet'));
    
    if (betType === 'number') {
      const modal = new ModalBuilder()
        .setCustomId('roulette_number_modal')
        .setTitle('🔢 اختر رقمك');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('roulette_bet_amount')
            .setLabel('مبلغ الرهان')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`بين ${minBet} و ${maxBet}`)
            .setRequired(true)
            .setMaxLength(5)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('roulette_number_value')
            .setLabel('الرقم (0-36)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('أدخل رقم بين 0 و 36')
            .setRequired(true)
            .setMaxLength(2)
        )
      );
      return interaction.showModal(modal);
    }
    
    // Show bet amount modal for other types
    const modal = new ModalBuilder()
      .setCustomId('roulette_bet_modal')
      .setTitle('💰 أدخل مبلغ الرهان');
    
    const labelMap = {
      red: 'رهان على أحمر 🔴',
      black: 'رهان على أسود ⚫',
      green: 'رهان على أخضر 🟢',
      even: 'رهان على زوجي ⚖️',
      odd: 'رهان على فردي 🎲',
      low: 'رهان على 1-18 📉',
      high: 'رهان على 19-36 📈',
    };
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('roulette_bet_amount')
          .setLabel(labelMap[betType] || 'مبلغ الرهان')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`بين ${minBet} و ${maxBet}`)
          .setRequired(true)
          .setMaxLength(5)
      )
    );
    
    // Store bet type for modal
    interaction.deferUpdate();
    activeGames.set(`${interaction.user.id}_roulette_type`, betType);
    return;
  }
  
  // ─── SLOTS BUTTONS ───
  if (customId.startsWith('slots_')) {
    const betAmount = parseInt(customId.replace('slots_', ''));
    const user = getUser(interaction.user.id);
    
    if (user.coins < betAmount) {
      return interaction.reply({
        embeds: [createEmbed('❌ رصيد غير كافٍ', `رصيدك: ${formatCoins(user.coins)} | الرهان: ${formatCoins(betAmount)}`, '#FF0000')],
        ephemeral: true
      });
    }
    
    updateCoins(interaction.user.id, -betAmount);
    
    const result = spinSlots(betAmount, interaction.user.id);
    
    if (result.won) {
      updateCoins(interaction.user.id, result.winnings);
      updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
      recordWin(interaction.user.id);
    } else {
      recordLoss(interaction.user.id);
    }
    
    const embed = createEmbed(
      result.won ? '🎉 فزت!' : '😔 لم تفز',
      `${result.result}\n**${result.message}**\n${result.won ? `🎁 ربحت: ${formatCoins(result.winnings)}` : `💸 خسرت: ${formatCoins(betAmount)}`}\n💰 رصيدك: ${formatCoins(getUser(interaction.user.id).coins)}`,
      result.won ? '#00FF00' : '#FF0000'
    );
    
    const buttons = [
      new ButtonBuilder().setCustomId(`slots_${betAmount}`).setLabel('🔄 مرة أخرى').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('slots_menu').setLabel('💰 تغيير الرهان').setStyle(ButtonStyle.Secondary),
    ];
    
    interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
    return;
  }
  
  // ─── DICE BUTTONS ───
  if (customId.startsWith('dice_')) {
    const betType = customId.replace('dice_', '');
    
    if (betType === 'bet') {
      const modal = new ModalBuilder()
        .setCustomId('dice_bet_modal')
        .setTitle('💰 مبلغ الرهان');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('dice_bet_amount')
            .setLabel('المبلغ')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('أدخل المبلغ')
            .setRequired(true)
            .setMaxLength(5)
        )
      );
      interaction.deferUpdate();
      activeGames.set(`${interaction.user.id}_dice_type`, 'bet_with_type');
      return;
    }
    
    const modal = new ModalBuilder()
      .setCustomId('dice_bet_modal')
      .setTitle('💰 مبلغ الرهان');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dice_bet_amount')
          .setLabel('المبلغ')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('أدخل المبلغ')
          .setRequired(true)
          .setMaxLength(5)
      )
    );
    
    interaction.deferUpdate();
    activeGames.set(`${interaction.user.id}_dice_type`, betType);
    interaction.showModal(modal);
    return;
  }
  
  // ─── DASHBOARD BUTTONS ───
  if (customId.startsWith('dash_')) {
    const isAdmin = ADMIN_IDS.includes(interaction.user.id) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) return;
    
    switch (customId) {
      case 'dash_settings':
        return handleDashboardSettings(interaction);
      case 'dash_games':
        return handleDashboardGames(interaction);
      case 'dash_back':
        return handleDashboard(interaction);
      case 'dash_shop':
        {
          const items = db.prepare('SELECT * FROM shop_items').all();
          const embed = createEmbed('🛒 إدارة المتجر', `${items.length} عنصر في المتجر`, '#1ABC9C');
          items.slice(0, 5).forEach(item => {
            embed.addFields({ name: `${item.emoji} ${item.name} (${item.active ? '✅' : '❌'})`, value: `💰 ${item.price} | 📂 ${item.category}`, inline: true });
          });
          interaction.reply({ embeds: [embed], components: [createButtons(
            new ButtonBuilder().setCustomId('dash_add_item').setLabel('➕ إضافة').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('dash_back').setLabel('↩️ رجوع').setStyle(ButtonStyle.Secondary)
          )] });
          return;
        }
      case 'dash_add_item':
        {
          const modal = new ModalBuilder()
            .setCustomId('dash_add_item_modal')
            .setTitle('➕ إضافة عنصر للمتجر');
          modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_name').setLabel('الاسم').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_desc').setLabel('الوصف').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_price').setLabel('السعر').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_category').setLabel('الفئة (armor/weapon/special)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('item_emoji').setLabel('إيموجي').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2))
          );
          return interaction.showModal(modal);
        }
      case 'dash_toggle_maint':
        {
          const current = getSetting('game_maintenance');
          const newVal = current === '1' ? '0' : '1';
          setSetting('game_maintenance', newVal);
          const msg = newVal === '1' ? '🔧 تم تفعيل وضع الصيانة' : '✅ تم إيقاف وضع الصيانة';
          return handleDashboardGames(interaction);
        }
      case 'dash_edit_coins':
      case 'dash_edit_xp':
      case 'dash_edit_daily':
      case 'dash_edit_minbet':
      case 'dash_edit_maxbet':
      case 'dash_edit_spins':
        {
          const settingMap = {
            dash_edit_coins: ['coins_per_win', 'عملات الفوز'],
            dash_edit_xp: ['xp_per_win', 'XP الفوز'],
            dash_edit_daily: ['daily_bonus', 'المكافأة اليومية'],
            dash_edit_minbet: ['min_bet', 'أقل رهان'],
            dash_edit_maxbet: ['max_bet', 'أعلى رهان'],
            dash_edit_spins: ['roulette_spins', 'دورات الروليت'],
          };
          const [key, label] = settingMap[customId];
          const modal = new ModalBuilder()
            .setCustomId('dash_edit_setting')
            .setTitle(`⚙️ تعديل ${label}`);
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('setting_value')
                .setLabel(label)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(`القيمة الحالية: ${getSetting(key)}`)
                .setRequired(true)
                .setMaxLength(10)
            )
          );
          activeGames.set(`${interaction.user.id}_setting_key`, key);
          return interaction.showModal(modal);
        }
      case 'dash_stats':
        {
          const stats = db.prepare(`
            SELECT 
              (SELECT COUNT(*) FROM users) as users,
              (SELECT SUM(coins) FROM users) as total_coins,
              (SELECT SUM(wins) FROM users) as total_wins,
              (SELECT SUM(losses) FROM users) as total_losses,
              (SELECT COUNT(*) FROM roulette_history) as roulette_spins
          `).get();
          
          const embed = createEmbed('📊 إحصائيات البوت', '', '#1ABC9C');
          embed.addFields(
            { name: '👥 المستخدمون', value: stats.users.toString(), inline: true },
            { name: '💰 إجمالي العملات', value: (stats.total_coins || 0).toString(), inline: true },
            { name: '🏆 إجمالي الانتصارات', value: (stats.total_wins || 0).toString(), inline: true },
            { name: '❌ إجمالي الخسائر', value: (stats.total_losses || 0).toString(), inline: true },
            { name: '🎰 دورات الروليت', value: (stats.roulette_spins || 0).toString(), inline: true },
            { name: '📈 نسبة الفوز العامة', value: (stats.total_wins + stats.total_losses) > 0 ? `${(((stats.total_wins || 0) / ((stats.total_wins || 0) + (stats.total_losses || 0))) * 100).toFixed(1)}%` : 'N/A', inline: true }
          );
          return interaction.reply({ embeds: [embed], components: [createButtons(
            new ButtonBuilder().setCustomId('dash_back').setLabel('↩️ رجوع').setStyle(ButtonStyle.Secondary)
          )] });
        }
    }
    return;
  }
  
  // ─── TRIVIA BUTTONS ───
  if (customId.startsWith('trivia_')) {
    const selected = customId.replace('trivia_', '');
    // Get the question answer from the interaction context
    // Since we can't easily retrieve the original question, we'll use a different approach
    // We store the answer in the game data
    const gameData = activeGames.get(`${interaction.user.id}_trivia`);
    
    if (!gameData) {
      // Find the question by the correct answer
      const matchingQ = triviaQuestions.find(q => q.a === selected);
      if (matchingQ) {
        activeGames.set(`${interaction.user.id}_trivia`, { answer: matchingQ.a });
        return handleTriviaAnswer(interaction, selected, matchingQ.a);
      }
      return;
    }
    
    return handleTriviaAnswer(interaction, selected, gameData.answer);
  }
  
  // ─── RPS BUTTONS ───
  if (customId.startsWith('rps_')) {
    const playerChoice = customId.replace('rps_', '');
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    
    const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
    const names = { rock: 'حجرة', paper: 'ورقة', scissors: 'مقص' };
    
    let result = '';
    let won = false;
    
    if (playerChoice === botChoice) {
      result = '🤝 تعادل!';
    } else if (
      (playerChoice === 'rock' && botChoice === 'scissors') ||
      (playerChoice === 'paper' && botChoice === 'rock') ||
      (playerChoice === 'scissors' && botChoice === 'paper')
    ) {
      result = '🎉 فزت!';
      won = true;
    } else {
      result = '😔 خسرت!';
    }
    
    const embed = createEmbed('✂️ النتيجة', 
      `أنت: ${emojis[playerChoice]} ${names[playerChoice]}\nالبوت: ${emojis[botChoice]} ${names[botChoice]}\n\n**${result}**`,
      won ? '#00FF00' : result === '🤝 تعادل!' ? '#FF9900' : '#FF0000'
    );
    
    if (won) {
      const coins = parseInt(getSetting('coins_per_win'));
      updateCoins(interaction.user.id, coins);
      updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
      recordWin(interaction.user.id);
      embed.setDescription(embed.data.description + `\n💰 ربحت: ${formatCoins(coins)}`);
    } else if (result === '😔 خسرت!') {
      recordLoss(interaction.user.id);
    }
    
    interaction.reply({ embeds: [embed] });
    return;
  }
  
  // ─── MATH BUTTONS ───
  if (customId.startsWith('math_')) {
    const selected = customId.replace('math_', '');
    const gameData = activeGames.get(`${interaction.user.id}_math`);
    
    if (!gameData) return;
    
    const correct = gameData.answer;
    const isCorrect = selected === correct;
    
    const embed = createEmbed(
      isCorrect ? '🎉 إجابة صحيحة!' : '❌ إجابة خاطئة!',
      isCorrect 
        ? `الإجابة الصحيحة: **${correct}**\n💰 ربحت: ${formatCoins(parseInt(getSetting('coins_per_win')))}\n⭐ XP: +${getSetting('xp_per_win')}`
        : `الإجابة الصحيحة كانت: **${correct}**\nاخترت: **${selected}**`,
      isCorrect ? '#00FF00' : '#FF0000'
    );
    
    if (isCorrect) {
      updateCoins(interaction.user.id, parseInt(getSetting('coins_per_win')));
      updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
      recordWin(interaction.user.id);
    } else {
      recordLoss(interaction.user.id);
    }
    
    interaction.reply({ embeds: [embed] });
    activeGames.delete(`${interaction.user.id}_math`);
    return;
  }
  
  // ─── COIN FLIP BUTTONS ───
  if (customId.startsWith('coin_')) {
    const choice = customId.replace('coin_', '');
    const minBet = parseInt(getSetting('min_bet'));
    const maxBet = parseInt(getSetting('max_bet'));
    
    activeGames.set(`${interaction.user.id}_coin_choice`, choice);
    
    const modal = new ModalBuilder()
      .setCustomId('coinflip_bet_modal')
      .setTitle('💰 مبلغ الرهان');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('coinflip_bet_amount')
          .setLabel('المبلغ')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(`بين ${minBet} و ${maxBet}`)
          .setRequired(true)
          .setMaxLength(5)
      )
    );
    interaction.showModal(modal);
    return;
  }
  
  // ─── FIGHT BUTTONS ───
  if (customId.startsWith('fight_')) {
    const action = customId.replace('fight_', '');
    const gameData = activeGames.get(`${interaction.user.id}_fight`);
    
    if (!gameData) {
      return interaction.reply({ embeds: [createEmbed('❌ خطأ', 'لا توجد مباراة نشطة!', '#FF0000')], ephemeral: true });
    }
    
    const { playerHP, opponentHP, playerAttack, opponentAttack, opponentName, opponentEmoji } = gameData;
    
    // Player turn
    let playerDamage = 0;
    let opponentDamage = 0;
    let log = '';
    
    if (action === 'attack') {
      playerDamage = Math.floor(playerAttack * (0.8 + Math.random() * 0.4));
      log = `⚔️ هاجمت ${opponentEmoji} ${opponentName} وأصبت بـ **${playerDamage}** ضرر!`;
    } else if (action === 'defend') {
      opponentDamage = Math.floor(opponentAttack * 0.3);
      log = `🛡️ دافعت عن نفسك! ضرر ${opponentEmoji}: **${opponentDamage}**`;
    } else if (action === 'special') {
      const chance = Math.random();
      if (chance > 0.5) {
        playerDamage = Math.floor(playerAttack * 2);
        log = `✨ هجوم خاص ناجح! أصبت **${playerDamage}** ضرر!`;
      } else {
        log = `✨ فشل الهجوم الخاص!`;
      }
    }
    
    gameData.playerHP -= opponentDamage;
    gameData.opponentHP -= playerDamage;
    gameData.log.push(log);
    
    const embed = createEmbed(
      '⚔️ مبارزة - جولة جديدة',
      `${log}\n\n**${interaction.user.username}** ❤️ ${Math.max(0, gameData.playerHP)}\n**${opponentEmoji} ${opponentName}** ❤️ ${Math.max(0, gameData.opponentHP)}\n\n**سجل المعركة:**\n${gameData.log.slice(-3).join('\n')}`,
      gameData.playerHP > 0 && gameData.opponentHP > 0 ? '#E74C3C' : gameData.playerHP > 0 ? '#00FF00' : '#FF0000'
    );
    
    if (gameData.opponentHP <= 0) {
      const winnings = parseInt(getSetting('coins_per_win')) + 100;
      updateCoins(interaction.user.id, winnings);
      const lvlResult = updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')) * 2);
      recordWin(interaction.user.id);
      
      embed.setDescription(embed.data.description + `\n\n🎉 **فزت بالمبارزة!**\n💰 ربحت: ${formatCoins(winnings)}\n${lvlResult.leveledUp ? `🎉 مستوى جديد: ${lvlResult.newLevel}!` : ''}`);
      activeGames.delete(`${interaction.user.id}_fight`);
      
      return interaction.reply({ embeds: [embed] });
    }
    
    if (gameData.playerHP <= 0) {
      recordLoss(interaction.user.id);
      embed.setDescription(embed.data.description + '\n\n😔 **لقد خسرت!** حاول مرة أخرى!');
      activeGames.delete(`${interaction.user.id}_fight`);
      
      return interaction.reply({ embeds: [embed] });
    }
    
    // Opponent attacks
    if (action !== 'defend') {
      opponentDamage = Math.floor(opponentAttack * (0.7 + Math.random() * 0.6));
      gameData.playerHP -= opponentDamage;
      gameData.log.push(`${opponentEmoji} ${opponentName} هاجمك وأصاب بـ **${opponentDamage}** ضرر!`);
    }
    
    // Check if player died from opponent counter-attack
    if (gameData.playerHP <= 0) {
      recordLoss(interaction.user.id);
      embed.setDescription(embed.data.description + '\n\n😔 **لقد خسرت!** حاول مرة أخرى!');
      activeGames.delete(`${interaction.user.id}_fight`);
      return interaction.reply({ embeds: [embed] });
    }
    
    embed.addFields({ name: '📜 سجل المعركة', value: gameData.log.slice(-4).join('\n'), inline: false });
    
    interaction.reply({ embeds: [embed], components: [createButtons(
      new ButtonBuilder().setCustomId('fight_attack').setLabel('⚔️ هجوم').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('fight_defend').setLabel('🛡️ دفاع').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('fight_special').setLabel('✨ هجوم خاص').setStyle(ButtonStyle.Secondary),
    )] });
    return;
  }
  
  // ─── SNAKE BUTTONS ───
  if (customId.startsWith('snake_')) {
    const direction = customId.replace('snake_', '');
    const gameData = activeGames.get(`${interaction.user.id}_snake`);
    
    if (!gameData) return;
    
    const { gridSize, snake, food } = gameData;
    let newDirection = direction;
    
    // Prevent reverse direction
    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
    if (opposites[newDirection] === gameData.direction && snake.length > 1) {
      newDirection = gameData.direction;
    }
    gameData.direction = newDirection;
    
    // Move snake
    const head = [...snake[0]];
    switch (newDirection) {
      case 'up': head[1]--; break;
      case 'down': head[1]++; break;
      case 'left': head[0]--; break;
      case 'right': head[0]++; break;
    }
    
    // Check collisions
    if (head[0] < 0 || head[0] >= gridSize || head[1] < 0 || head[1] >= gridSize) {
      const embed = createEmbed('💀 انتهت اللعبة!', `النقاط: ${gameData.score}\n\nحاول مرة أخرى!`, '#FF0000');
      if (gameData.score >= 5) {
        const coins = gameData.score * 20;
        updateCoins(interaction.user.id, coins);
        updateXP(interaction.user.id, gameData.score * 10);
        recordWin(interaction.user.id);
        embed.setDescription(embed.data.description + `\n💰 ربحت: ${formatCoins(coins)}`);
      } else {
        recordLoss(interaction.user.id);
      }
      activeGames.delete(`${interaction.user.id}_snake`);
      return interaction.reply({ embeds: [embed] });
    }
    
    // Check self collision
    if (snake.some(s => s[0] === head[0] && s[1] === head[1])) {
      const embed = createEmbed('💀 اصطدمت بنفسك!', `النقاط: ${gameData.score}\n\nحاول مرة أخرى!`, '#FF0000');
      if (gameData.score >= 5) {
        const coins = gameData.score * 20;
        updateCoins(interaction.user.id, coins);
        updateXP(interaction.user.id, gameData.score * 10);
        recordWin(interaction.user.id);
        embed.setDescription(embed.data.description + `\n💰 ربحت: ${formatCoins(coins)}`);
      }
      activeGames.delete(`${interaction.user.id}_snake`);
      return interaction.reply({ embeds: [embed] });
    }
    
    snake.unshift(head);
    
    // Check food
    if (head[0] === food[0] && head[1] === food[1]) {
      gameData.score++;
      // New food
      let newFood;
      do {
        newFood = [Math.floor(Math.random() * gridSize), Math.floor(Math.random() * gridSize)];
      } while (snake.some(s => s[0] === newFood[0] && s[1] === newFood[1]));
      gameData.food = newFood;
    } else {
      snake.pop();
    }
    
    const board = renderSnakeBoard(gridSize, snake, gameData.food);
    const embed = createEmbed('🐍 الثعبان', 
      `\`\`\`\n${board}\`\`\`\n**النقاط: ${gameData.score}**`,
      '#27AE60'
    );
    
    interaction.reply({ embeds: [embed], components: [createButtons(
      new ButtonBuilder().setCustomId('snake_up').setLabel('⬆️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('snake_left').setLabel('⬅️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('snake_right').setLabel('➡️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('snake_down').setLabel('⬇️').setStyle(ButtonStyle.Primary),
    )] });
    return;
  }
  
  // ─── SLOTS MENU BUTTON ───
  if (customId === 'slots_menu') {
    return handleSlots(interaction);
  }
}

// ─── TRIvia ANSWER HELPER ───
function handleTriviaAnswer(interaction, selected, correct) {
  const isCorrect = selected === correct;
  
  const embed = createEmbed(
    isCorrect ? '🎉 إجابة صحيحة!' : '❌ إجابة خاطئة!',
    isCorrect
      ? `💰 ربحت: ${formatCoins(parseInt(getSetting('coins_per_win')))}\n⭐ XP: +${getSetting('xp_per_win')}`
      : `الإجابة الصحيحة: **${correct}**`,
    isCorrect ? '#00FF00' : '#FF0000'
  );
  
  if (isCorrect) {
    updateCoins(interaction.user.id, parseInt(getSetting('coins_per_win')));
    updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
    recordWin(interaction.user.id);
  } else {
    recordLoss(interaction.user.id);
  }
  
  interaction.reply({ embeds: [embed] });
  activeGames.delete(`${interaction.user.id}_trivia`);
}

// ═══════════════════════════════════════════════════════════
// SELECT MENU INTERACTION HANDLER
// ═══════════════════════════════════════════════════════════
function handleSelectMenuInteraction(interaction) {
  // Reserved for future use
}

// ═══════════════════════════════════════════════════════════
// MODAL INTERACTION HANDLER
// ═══════════════════════════════════════════════════════════
async function handleModalInteraction(interaction) {
  const customId = interaction.customId;
  
  // ─── BLACKJACK BET ───
  if (customId === 'blackjack_bet') {
    const betAmount = parseInt(interaction.fields.getTextInputValue('bet_amount'));
    const user = getUser(interaction.user.id);
    const minBet = parseInt(getSetting('min_bet'));
    const maxBet = parseInt(getSetting('max_bet'));
    
    if (isNaN(betAmount) || betAmount < minBet || betAmount > maxBet) {
      return interaction.reply({
        embeds: [createEmbed('❌ رهان غير صالح', `الرهان يجب أن يكون بين ${formatCoins(minBet)} و ${formatCoins(maxBet)}`, '#FF0000')],
        ephemeral: true
      });
    }
    
    if (user.coins < betAmount) {
      return interaction.reply({
        embeds: [createEmbed('❌ رصيد غير كافٍ', `رصيدك: ${formatCoins(user.coins)}`, '#FF0000')],
        ephemeral: true
      });
    }
    
    updateCoins(interaction.user.id, -betAmount);
    startBlackjackGame(interaction, betAmount);
    return;
  }
  
  // ─── WORD GUESS ───
  if (customId === 'word_guess') {
    const guess = interaction.fields.getTextInputValue('guess').trim();
    const gameData = activeGames.get(`${interaction.user.id}_word`);
    
    if (!gameData) return;
    
    const coinsPerWin = parseInt(getSetting('coins_per_win')) + gameData.entry;
    const isCorrect = guess.toLowerCase() === gameData.word.toLowerCase();
    
    const embed = createEmbed(
      isCorrect ? '🎉 إجابة صحيحة!' : '❌ إجابة خاطئة!',
      isCorrect
        ? `الكلمة كانت: **${gameData.word}**\n💰 ربحت: ${formatCoins(coinsPerWin)}\n⭐ XP: +${getSetting('xp_per_win')}`
        : `الكلمة كانت: **${gameData.word}**\nأجابتك: **${guess}**`,
      isCorrect ? '#00FF00' : '#FF0000'
    );
    
    if (isCorrect) {
      updateCoins(interaction.user.id, coinsPerWin);
      updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
      recordWin(interaction.user.id);
    } else {
      recordLoss(interaction.user.id);
    }
    
    activeGames.delete(`${interaction.user.id}_word`);
    interaction.reply({ embeds: [embed] });
    return;
  }
  
  // ─── MEMORY PICK ───
  if (customId === 'memory_pick') {
    const pickNum = parseInt(interaction.fields.getTextInputValue('pick_number'));
    const gameData = activeGames.get(`${interaction.user.id}_memory`);
    
    if (!gameData || isNaN(pickNum) || pickNum < 1 || pickNum > 12) {
      return interaction.reply({ embeds: [createEmbed('❌ خطأ', 'أدخل رقم بين 1 و 12', '#FF0000')], ephemeral: true });
    }
    
    const emoji = gameData.cards[pickNum - 1];
    const coinsPerWin = parseInt(getSetting('coins_per_win'));
    
    // Simple: if they pick a valid card, they get coins
    // In a real game, this would be more complex
    updateCoins(interaction.user.id, Math.floor(coinsPerWin / 2));
    updateXP(interaction.user.id, Math.floor(parseInt(getSetting('xp_per_win')) / 2));
    recordWin(interaction.user.id);
    
    const embed = createEmbed('🧩 الذاكرة', 
      `البطاقة #${pickNum} = ${emoji}\n💰 ربحت: ${formatCoins(Math.floor(coinsPerWin / 2))}`,
      '#9B59B6'
    );
    
    activeGames.delete(`${interaction.user.id}_memory`);
    interaction.reply({ embeds: [embed] });
    return;
  }
  
  // ─── COINFLIP BET ───
  if (customId === 'coinflip_bet_modal') {
    const betAmount = parseInt(interaction.fields.getTextInputValue('coinflip_bet_amount'));
    const choice = activeGames.get(`${interaction.user.id}_coin_choice`);
    const user = getUser(interaction.user.id);
    const minBet = parseInt(getSetting('min_bet'));
    const maxBet = parseInt(getSetting('max_bet'));
    
    if (isNaN(betAmount) || betAmount < minBet || betAmount > maxBet) {
      return interaction.reply({
        embeds: [createEmbed('❌ رهان غير صالح', `بين ${formatCoins(minBet)} و ${formatCoins(maxBet)}`, '#FF0000')],
        ephemeral: true
      });
    }
    
    if (user.coins < betAmount) {
      return interaction.reply({ embeds: [createEmbed('❌ رصيد غير كافٍ', `رصيدك: ${formatCoins(user.coins)}`, '#FF0000')], ephemeral: true });
    }
    
    updateCoins(interaction.user.id, -betAmount);
    
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = choice === result;
    const winnings = won ? betAmount * 2 : 0;
    
    if (won) {
      updateCoins(interaction.user.id, winnings);
      updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
      recordWin(interaction.user.id);
    } else {
      recordLoss(interaction.user.id);
    }
    
    const emojis = { heads: '👑', tails: '🪙' };
    const names = { heads: 'وجه', tails: 'صورة' };
    
    interaction.reply({ embeds: [createEmbed(
      won ? '🎉 فزت!' : '😔 لم تفز',
      `العملة: ${emojis[result]} ${names[result]}\nاخترت: ${emojis[choice]} ${names[choice]}\n${won ? `💰 ربحت: ${formatCoins(winnings)}` : `💸 خسرت: ${formatCoins(betAmount)}`}\n💰 رصيدك: ${formatCoins(getUser(interaction.user.id).coins)}`,
      won ? '#00FF00' : '#FF0000'
    )] });
    
    activeGames.delete(`${interaction.user.id}_coin_choice`);
    return;
  }
  
  // ─── ROULETTE BET MODAL ───
  if (customId === 'roulette_bet_modal' || customId === 'roulette_number_modal') {
    const betAmount = parseInt(interaction.fields.getTextInputValue('roulette_bet_amount'));
    const minBet = parseInt(getSetting('min_bet'));
    const maxBet = parseInt(getSetting('max_bet'));
    
    if (isNaN(betAmount) || betAmount < minBet || betAmount > maxBet) {
      return interaction.reply({
        embeds: [createEmbed('❌ رهان غير صالح', `بين ${formatCoins(minBet)} و ${formatCoins(maxBet)}`, '#FF0000')],
        ephemeral: true
      });
    }
    
    const user = getUser(interaction.user.id);
    if (user.coins < betAmount) {
      return interaction.reply({ embeds: [createEmbed('❌ رصيد غير كافٍ', `رصيدك: ${formatCoins(user.coins)}`, '#FF0000')], ephemeral: true });
    }
    
    let betType, betValue = null;
    if (customId === 'roulette_number_modal') {
      betType = 'number';
      betValue = parseInt(interaction.fields.getTextInputValue('roulette_number_value'));
      if (isNaN(betValue) || betValue < 0 || betValue > 36) {
        return interaction.reply({ embeds: [createEmbed('❌ رقم غير صالح', 'يجب أن يكون بين 0 و 36', '#FF0000')], ephemeral: true });
      }
    } else {
      betType = activeGames.get(`${interaction.user.id}_roulette_type`) || 'red';
    }
    
    updateCoins(interaction.user.id, -betAmount);
    
    // Show spinning animation message
    const spinEmbed = createEmbed('🎰 الروليت تدور...', 'جاري تدوير العجلة! ⏳', '#E74C3C');
    const spinMsg = await interaction.reply({ embeds: [spinEmbed], fetchReply: true });
    
    const spins = parseInt(getSetting('roulette_spins')) || 12;
    
    for (let i = 0; i < spins; i++) {
      const tempResult = Math.floor(Math.random() * 37);
      const tempEmbed = createEmbed(
        `🎰 الروليت تدور... (${i + 1}/${spins})`,
        `${createRouletteVisual(tempResult)}\nرهانك: **${betType}**${betValue !== null ? ` (${betValue})` : ''}`,
        '#E74C3C'
      );
      try {
        await spinMsg.edit({ embeds: [tempEmbed] });
      } catch(e) {}
      await sleep(300);
    }
    
    // Final result
    const result = spinRoulette(betType, betValue, betAmount, interaction.user.id);
    
    if (result.won) {
      updateCoins(interaction.user.id, result.winnings);
      updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
      recordWin(interaction.user.id);
    } else {
      recordLoss(interaction.user.id);
    }
    
    const finalEmbed = createEmbed(
      result.won ? '🎉 فزت في الروليت!' : '😔 لم تفز هذه المرة',
      `${createRouletteVisual(result.result)}\nرهانك: **${betType}**${betValue !== null ? ` (${betValue})` : ''}\n${result.won ? `💰 ربحت: ${formatCoins(result.winnings)}` : `💸 خسرت: ${formatCoins(betAmount)}`}\n💰 رصيدك: ${formatCoins(getUser(interaction.user.id).coins)}`,
      result.won ? '#00FF00' : '#FF0000'
    );
    
    try {
      await spinMsg.edit({ embeds: [finalEmbed] });
    } catch(e) {
      await spinMsg.edit({ embeds: [finalEmbed] });
    }
    
    activeGames.delete(`${interaction.user.id}_roulette_type`);
    return;
  }
  
  // ─── DICE BET ───
  if (customId === 'dice_bet_modal') {
    const betAmount = parseInt(interaction.fields.getTextInputValue('dice_bet_amount'));
    const minBet = parseInt(getSetting('min_bet'));
    const maxBet = parseInt(getSetting('max_bet'));
    
    if (isNaN(betAmount) || betAmount < minBet || betAmount > maxBet) {
      return interaction.reply({ embeds: [createEmbed('❌ رهان غير صالح', `بين ${formatCoins(minBet)} و ${formatCoins(maxBet)}`, '#FF0000')], ephemeral: true });
    }
    
    const user = getUser(interaction.user.id);
    if (user.coins < betAmount) {
      return interaction.reply({ embeds: [createEmbed('❌ رصيد غير كافٍ', `رصيدك: ${formatCoins(user.coins)}`, '#FF0000')], ephemeral: true });
    }
    
    updateCoins(interaction.user.id, -betAmount);
    
    const roll = rollDice();
    const diceType = activeGames.get(`${interaction.user.id}_dice_type`);
    
    let won = false;
    let multiplier = 0;
    
    switch (diceType) {
      case 'low':
        won = roll.total <= 6;
        multiplier = 2;
        break;
      case 'middle':
        won = roll.total === 7;
        multiplier = 5;
        break;
      case 'high':
        won = roll.total >= 8;
        multiplier = 2;
        break;
      case 'bet_with_type':
        // Default to even/odd based on result
        won = roll.total % 2 === 0;
        multiplier = 2;
        break;
      default:
        won = Math.random() > 0.5;
        multiplier = 2;
    }
    
    const winnings = won ? betAmount * multiplier : 0;
    
    if (won) {
      updateCoins(interaction.user.id, winnings);
      updateXP(interaction.user.id, parseInt(getSetting('xp_per_win')));
      recordWin(interaction.user.id);
    } else {
      recordLoss(interaction.user.id);
    }
    
    interaction.reply({ embeds: [createEmbed(
      won ? '🎉 فزت!' : '😔 لم تفز',
      `🎲 النرد الأول: **${roll.die1}** | 🎲 النرد الثاني: **${roll.die2}**\n📊 المجموع: **${roll.total}**\n${won ? `💰 ربحت: ${formatCoins(winnings)}` : `💸 خسرت: ${formatCoins(betAmount)}`}\n💰 رصيدك: ${formatCoins(getUser(interaction.user.id).coins)}`,
      won ? '#00FF00' : '#FF0000'
    )] });
    
    activeGames.delete(`${interaction.user.id}_dice_type`);
    return;
  }
  
  // ─── DASHBOARD ADD ITEM ───
  if (customId === 'dash_add_item_modal') {
    const name = interaction.fields.getTextInputValue('item_name').trim();
    const desc = interaction.fields.getTextInputValue('item_desc').trim();
    const price = parseInt(interaction.fields.getTextInputValue('item_price'));
    const category = interaction.fields.getTextInputValue('item_category').trim();
    const emoji = interaction.fields.getTextInputValue('item_emoji').trim() || '📦';
    
    if (isNaN(price) || price < 1) {
      return interaction.reply({ embeds: [createEmbed('❌ سعر غير صالح', 'يجب أن يكون السعر رقم موجب', '#FF0000')], ephemeral: true });
    }
    
    db.prepare('INSERT INTO shop_items (name, description, price, category, emoji) VALUES (?, ?, ?, ?, ?)').run(name, desc, price, category, emoji);
    
    interaction.reply({ embeds: [createEmbed('✅ تم الإضافة!', `${emoji} **${name}** تم إضافته للمتجر بسعر ${formatCoins(price)}`, '#00FF00')] });
    return;
  }
  
  // ─── DASHBOARD EDIT SETTING ───
  if (customId === 'dash_edit_setting') {
    const key = activeGames.get(`${interaction.user.id}_setting_key`);
    const value = interaction.fields.getTextInputValue('setting_value').trim();
    
    if (!key) {
      return interaction.reply({ embeds: [createEmbed('❌ خطأ', 'مفتاح غير معروف', '#FF0000')], ephemeral: true });
    }
    
    setSetting(key, value);
    
    interaction.reply({ embeds: [createEmbed('✅ تم التعديل!', `تم تغيير إعداد **${key}** إلى: **${value}**`, '#00FF00')] });
    activeGames.delete(`${interaction.user.id}_setting_key`);
    return;
  }
}

// ═══════════════════════════════════════════════════════════
// MESSAGE EVENT (TEXT COMMANDS)
// ═══════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;
  
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  
  switch (command) {
    case 'ping':
      message.reply(`🏓pong! تأخير: ${Date.now() - message.createdTimestamp}ms`);
      break;
    case 'help':
      message.reply('اكتب `/help` لعرض قائمة الألعاب! 🎮');
      break;
    case 'balance':
    case 'bal':
      {
        const user = getUser(message.author.id);
        message.reply(`💰 رصيد ${message.author.username}: ${formatCoins(user.coins)}`);
      }
      break;
    case 'profile':
    case 'p':
      message.reply('اكتب `/profile` لعرض ملفك الشخصي! 👤');
      break;
    case 'daily':
      message.reply('اكتب `/daily` لاستلام مكافأتك اليومية! 🎁');
      break;
    case 'shop':
      message.reply('اكتب `/shop` لفتح المتجر! 🛒');
      break;
    case 'inventory':
    case 'inv':
      message.reply('اكتب `/inventory` لعرض حقيبتك! 🎒');
      break;
    case 'roulette':
    case 'roll':
      message.reply('اكتب `/roulette` لبدء لعبة الروليت! 🎰');
      break;
    case 'trivia':
      message.reply('اكتب `/trivia` لبدء لعبة الأسئلة! ❓');
      break;
    case 'blackjack':
    case 'bj':
      message.reply('اكتب `/blackjack` لبدء لعبة البلاك جاك! 🃏');
      break;
    case 'slots':
      message.reply('اكتب `/slots` لبدء ماكينات الحظ! 🎰');
      break;
    case 'dice':
      message.reply('اكتب `/dice` لبدء لعبة النرد! 🎲');
      break;
    case 'rps':
      message.reply('اكتب `/rps` لبدء حجرة ورقة مقص! ✂️');
      break;
    case 'fight':
      message.reply('اكتب `/fight` لبدء مبارزة قتالية! ⚔️');
      break;
    case 'coinflip':
    case 'flip':
      message.reply('اكتب `/coinflip` لرمي العملة! 🪙');
      break;
    case 'math':
      message.reply('اكتب `/math` لبدء لعبة الحساب! 🔢');
      break;
    case 'word':
      message.reply('اكتب `/word` لبدء تخمين الكلمة! 📝');
      break;
    case 'snake':
      message.reply('اكتب `/snake` لبدء لعبة الثعبان! 🐍');
      break;
    case 'memory':
      message.reply('اكتب `/memory` لبدء لعبة الذاكرة! 🧩');
      break;
  }
});

// ═══════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// ═══════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════
client.login(TOKEN);

// ═══════════════════════════════════════════════════════════
// EXPORTS (for testing)
// ═══════════════════════════════════════════════════════════
module.exports = { client, db };
