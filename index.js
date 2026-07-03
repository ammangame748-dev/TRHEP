// ═══════════════════════════════════════════════════════════
// 🎮 DISCORD GAMES BOT - 10+ GAMES, SHOP, DASHBOARD, ROULETTE
// ═══════════════════════════════════════════════════════════

const { Client, GatewayIntentBits, ActivityType, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');
const ms = require('ms');
const express = require('express');

// ═══════════════════════════════════════════════════════════
// WEB SERVER SETUP (FOR RENDER)
// ═══════════════════════════════════════════════════════════
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('✅ البوت يعمل بنجاح ومستعد للعب!');
});

app.listen(port, () => {
  console.log(`🌐 خادم الويب يعمل على المنفذ ${port}`);
});

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
client.once('clientReady', async () => {
  console.log(`✅ البوت متصل! ${client.user.tag}`);
  console.log(`📊 عدد السيرفرات: ${client.guilds.cache.size}`);
  
  client.user.setActivity('🎮 /help للألعاب | /shop للمتجر', { type: ActivityType.Playing });
  
  // Register slash commands
  registerCommands();
});

// For older versions support
client.once('ready', () => {
  if (!client.isReady()) return;
  console.log('🚀 تم إطلاق البوت بنجاح');
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
  if (interaction.isButton()) {
    handleButtonInteraction(interaction);
    return;
  }
  
  if (interaction.isStringSelectMenu()) {
    handleSelectMenuInteraction(interaction);
    return;
  }
  
  if (interaction.isModalSubmit()) {
    handleModalInteraction(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;

  if (getSetting('game_maintenance') === '1' && command !== 'dashboard') {
    return interaction.reply({
      embeds: [createEmbed('🔧 وضع الصيانة', 'الألعاب متوقفة حالياً للصيانة. يرجى المحاولة لاحقاً!', '#FF9900')],
      ephemeral: true
    });
  }

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
// HANDLER FUNCTIONS
// ═══════════════════════════════════════════════════════════

function handleHelp(interaction) {
  const embed = createEmbed('🎮 قائمة الألعاب المتاحة', 'استخدم الأوامر التالية للعب وكسب العملات!', '#5865F2');
  embed.addFields(
    { name: '🎰 ألعاب الحظ', value: '`/roulette`, `/slots`, `/coinflip`, `/dice`', inline: true },
    { name: '🧠 ألعاب الذكاء', value: '`/trivia`, `/math`, `/word`, `/memory`', inline: true },
    { name: '⚔️ ألعاب القتال', value: '`/fight`, `/rps`, `/snake`, `/blackjack`', inline: true },
    { name: '👤 الحساب', value: '`/profile`, `/balance`, `/daily`', inline: true },
    { name: '🛒 المتجر', value: '`/shop`, `/inventory`, `/equip`', inline: true },
    { name: '⚙️ الإدارة', value: '`/dashboard`', inline: true }
  );
  interaction.reply({ embeds: [embed] });
}

function handleProfile(interaction) {
  const user = getUser(interaction.user.id);
  const embed = createEmbed(`👤 ملف ${interaction.user.username}`, '', '#3498DB');
  embed.addFields(
    { name: '💰 العملات', value: formatCoins(user.coins), inline: true },
    { name: '⭐ المستوى', value: user.level.toString(), inline: true },
    { name: '📈 XP', value: `${user.xp % 500}/500`, inline: true },
    { name: '🏆 الانتصارات', value: user.wins.toString(), inline: true },
    { name: '❌ الخسائر', value: user.losses.toString(), inline: true },
    { name: '⚔️ التجهيز', value: user.equipped || 'لا يوجد', inline: true }
  );
  interaction.reply({ embeds: [embed] });
}

function handleBalance(interaction) {
  const user = getUser(interaction.user.id);
  interaction.reply({ embeds: [createEmbed('💰 رصيدك', `لديك حالياً: **${formatCoins(user.coins)}**`, '#F1C40F')] });
}

function handleDaily(interaction) {
  const userId = interaction.user.id;
  const lastDaily = JSON.parse(getSetting('last_daily_check'));
  const today = new Date().toISOString().split('T')[0];
  
  const userCheck = lastDaily.find(d => d.userId === userId);
  if (userCheck && userCheck.date === today) {
    return interaction.reply({ embeds: [createEmbed('❌ مكافأة يومية', 'لقد استلمت مكافأتك اليومية بالفعل! عد غداً.', '#FF0000')], ephemeral: true });
  }
  
  const bonus = parseInt(getSetting('daily_bonus'));
  updateCoins(userId, bonus);
  
  const newDaily = lastDaily.filter(d => d.userId !== userId);
  newDaily.push({ userId, date: today });
  setSetting('last_daily_check', JSON.stringify(newDaily));
  
  interaction.reply({ embeds: [createEmbed('🎁 مكافأة يومية', `لقد استلمت **${formatCoins(bonus)}**! رصيدك الجديد: ${formatCoins(getUser(userId).coins)}`, '#00FF00')] });
}

function handleShop(interaction) {
  const items = db.prepare('SELECT * FROM shop_items WHERE active = 1').all();
  const embed = createEmbed('🛒 متجر الألعاب', 'اشترِ العناصر لزيادة قوتك وتزيين ملفك!', '#9B59B6');
  
  const rows = [];
  for (let i = 0; i < items.length; i += 5) {
    const row = new ActionRowBuilder();
    items.slice(i, i + 5).forEach(item => {
      embed.addFields({ name: `${item.emoji} ${item.name}`, value: `💰 ${item.price}\n${item.description}`, inline: true });
      row.addComponents(new ButtonBuilder().setCustomId(`shop_buy_${item.id}`).setLabel(`شراء ${item.name}`).setStyle(ButtonStyle.Primary));
    });
    rows.push(row);
  }
  
  interaction.reply({ embeds: [embed], components: rows });
}

function handleInventory(interaction) {
  const user = getUser(interaction.user.id);
  let inventory;
  try { inventory = JSON.parse(user.inventory); } catch(e) { inventory = []; }
  
  const embed = createEmbed('🎒 حقيبتك', inventory.length > 0 ? inventory.join(', ') : 'حقيبتك فارغة حالياً!', '#E67E22');
  if (user.equipped) embed.addFields({ name: '⚔️ مجهز حالياً', value: user.equipped });
  
  interaction.reply({ embeds: [embed] });
}

function handleEquip(interaction) {
  const user = getUser(interaction.user.id);
  let inventory;
  try { inventory = JSON.parse(user.inventory); } catch(e) { inventory = []; }
  
  const itemName = interaction.options.getString('item_name');
  const found = inventory.find(i => i.toLowerCase() === itemName.toLowerCase());
  
  if (!found) {
    return interaction.reply({ embeds: [createEmbed('❌ خطأ', `لا تملك هذا العنصر: ${itemName}`, '#FF0000')], ephemeral: true });
  }
  
  db.prepare('UPDATE users SET equipped = ? WHERE id = ?').run(found, interaction.user.id);
  interaction.reply({ embeds: [createEmbed('⚔️ تم التجهيز!', `لقد قمت بتجهيز: **${found}** ✅`, '#00FF00')] });
}

function handleDashboard(interaction) {
  const isAdmin = ADMIN_IDS.includes(interaction.user.id) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) return interaction.reply({ embeds: [createEmbed('🔒 وصول مرفوض', 'هذا الأمر للمسؤولين فقط!', '#FF0000')], ephemeral: true });

  const action = interaction.options.getString('action') || 'view';
  if (action === 'settings') return handleDashboardSettings(interaction);
  if (action === 'games') return handleDashboardGames(interaction);

  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalShop = db.prepare('SELECT COUNT(*) as count FROM shop_items').get().count;
  const maintenance = getSetting('game_maintenance') === '1' ? '🔧 مفعل' : '✅ غير مفعل';
  
  const embed = createEmbed('⚙️ لوحة التحكم', `**مرحباً بالمسؤول!** 👑\nإجمالي المستخدمين: ${totalUsers}\nعناصر المتجر: ${totalShop}\nوضع الصيانة: ${maintenance}`, '#1ABC9C');
  const buttons = [
    new ButtonBuilder().setCustomId('dash_settings').setLabel('⚙️ إعدادات').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_games').setLabel('🎮 الألعاب').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_shop').setLabel('🛒 المتجر').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('dash_maintenance').setLabel('🔧 صيانة').setStyle(getSetting('game_maintenance') === '1' ? ButtonStyle.Danger : ButtonStyle.Secondary),
  ];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function handleDashboardSettings(interaction) {
  const embed = createEmbed('⚙️ إعدادات الداشبورد', 'اختر الإعداد لتعديله:', '#1ABC9C');
  embed.addFields(
    { name: '💰 عملات الفوز', value: getSetting('coins_per_win'), inline: true },
    { name: '🎁 مكافأة يومية', value: getSetting('daily_bonus'), inline: true },
    { name: '📉 أقل رهان', value: getSetting('min_bet'), inline: true },
    { name: '📈 أعلى رهان', value: getSetting('max_bet'), inline: true }
  );
  const buttons = [
    new ButtonBuilder().setCustomId('dash_edit_coins').setLabel('💰 عملات').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_edit_daily').setLabel('🎁 يومي').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dash_edit_minbet').setLabel('📉 أقل').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_edit_maxbet').setLabel('📈 أعلى').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('dash_back').setLabel('↩️ رجوع').setStyle(ButtonStyle.Danger),
  ];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function handleDashboardGames(interaction) {
  const maintenance = getSetting('game_maintenance') === '1';
  const embed = createEmbed('🎮 إدارة الألعاب', maintenance ? '🔴 وضع الصيانة مفعل' : '🟢 الألعاب تعمل بشكل طبيعي', '#1ABC9C');
  const buttons = [
    new ButtonBuilder().setCustomId(`dash_toggle_maint`).setLabel(maintenance ? '✅ إيقاف الصيانة' : '🔧 تفعيل الصيانة').setStyle(maintenance ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('dash_back').setLabel('↩️ رجوع').setStyle(ButtonStyle.Secondary),
  ];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// 🎰 ROULETTE
function handleRoulette(interaction) {
  const user = getUser(interaction.user.id);
  const embed = createEmbed('🎰 لعبة الروليت', `💰 رصيدك: ${formatCoins(user.coins)}\nاختر مكان رهانك!`, '#E74C3C');
  const buttons = [
    new ButtonBuilder().setCustomId('roulette_red').setLabel('🔴 أحمر').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('roulette_black').setLabel('⚫ أسود').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('roulette_green').setLabel('🟢 أخضر').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('roulette_number').setLabel('🔢 رقم').setStyle(ButtonStyle.Primary),
  ];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function createRouletteVisual(result) {
  const redNums = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  const numColor = result === 0 ? '🟢' : redNums.includes(result) ? '🔴' : '⚫';
  return `${numColor} الرقم: **${result}**`;
}

function spinRoulette(betType, betValue, betAmount, userId) {
  const result = Math.floor(Math.random() * 37);
  let won = false;
  let multiplier = 0;
  const redNums = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

  if (betType === 'red') { won = redNums.includes(result); multiplier = 2; }
  else if (betType === 'black') { won = result !== 0 && !redNums.includes(result); multiplier = 2; }
  else if (betType === 'green') { won = result === 0; multiplier = 14; }
  else if (betType === 'number') { won = result === betValue; multiplier = 36; }

  const winnings = won ? betAmount * multiplier : 0;
  db.prepare('INSERT INTO roulette_history (user_id, bet_amount, result, won) VALUES (?, ?, ?, ?)').run(userId, betAmount, result, won ? 1 : 0);
  return { result, won, winnings };
}

// ❓ TRIVIA
const triviaQuestions = [
  { q: 'ما هي عاصمة اليابان؟', a: 'طوكيو', options: ['طوكيو', 'بكين', 'سيول', 'بانكوك'] },
  { q: 'كم عدد كواكب المجموعة الشمسية؟', a: '8', options: ['7', '8', '9', '10'] },
  { q: 'ما هو أكبر محيط في العالم؟', a: 'الهادي', options: ['الأطلسي', 'الهندي', 'الهادي', 'المتجمد'] },
  { q: 'من اخترع المصباح الكهربائي؟', a: 'إديسون', options: ['تسلا', 'إديسون', 'بيل', 'نيوتن'] },
];

function handleTrivia(interaction) {
  const question = triviaQuestions[Math.floor(Math.random() * triviaQuestions.length)];
  const embed = createEmbed('❓ الأسئلة والأجوبة', `**${question.q}**`, '#3498DB');
  const shuffled = question.options.sort(() => Math.random() - 0.5);
  const buttons = shuffled.map(opt => new ButtonBuilder().setCustomId(`trivia_${opt}`).setLabel(opt).setStyle(ButtonStyle.Primary));
  activeGames.set(`${interaction.user.id}_trivia`, { answer: question.a });
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// 🃏 BLACKJACK
const blackjackSuits = ['♠️', '♥️', '♦️', '♣️'];
const blackjackValues = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createBlackjackDeck() {
  const deck = [];
  for (const suit of blackjackSuits) for (const value of blackjackValues) deck.push({ suit, value });
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
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function cardToString(card) { return `${card.value}${card.suit}`; }

function handleBlackjack(interaction) {
  const minBet = parseInt(getSetting('min_bet'));
  const modal = new ModalBuilder().setCustomId('blackjack_bet').setTitle('💰 رهان البلاك جاك');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bet_amount').setLabel('مبلغ الرهان').setStyle(TextInputStyle.Short).setRequired(true)));
  interaction.showModal(modal);
}

function startBlackjackGame(interaction, betAmount) {
  const deck = createBlackjackDeck();
  const playerHand = [deck.pop(), deck.pop()];
  const dealerHand = [deck.pop(), deck.pop()];
  const gameData = { deck, playerHand, dealerHand, betAmount, userId: interaction.user.id };
  activeGames.set(`${interaction.user.id}_blackjack`, gameData);
  updateBlackjackDisplay(interaction, gameData, false);
}

function updateBlackjackDisplay(interaction, gameData, dealerReveal) {
  const { playerHand, dealerHand, betAmount } = gameData;
  const dealerCards = dealerReveal ? dealerHand.map(cardToString).join(' ') : cardToString(dealerHand[0]) + ' 🂠';
  const embed = createEmbed('🃏 بلاك جاك', `💰 رهانك: ${formatCoins(betAmount)}\n\n**الموزع:** ${dealerCards}\n**أنت:** ${playerHand.map(cardToString).join(' ')}\n🔢 مجموعك: ${handTotal(playerHand)}`, '#2ECC71');
  
  if (handTotal(playerHand) > 21) {
    embed.setDescription(embed.data.description + '\n\n💥 **تجاوزت الـ 21! خسرت!**');
    activeGames.delete(`${gameData.userId}_blackjack`);
    recordLoss(gameData.userId);
    return interaction.reply ? interaction.reply({ embeds: [embed] }) : interaction.editReply({ embeds: [embed], components: [] });
  }

  const buttons = dealerReveal ? [] : [
    new ButtonBuilder().setCustomId('bj_hit').setLabel('🃏 سحب').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj_stand').setLabel('✋ وقف').setStyle(ButtonStyle.Secondary),
  ];
  
  const components = buttons.length > 0 ? [createButtons(...buttons)] : [];
  if (interaction.showModal) return interaction.reply({ embeds: [embed], components });
  return interaction.editReply({ embeds: [embed], components });
}

// 🎰 SLOTS
const slotSymbols = ['🍒', '🍋', '🍇', '🍊', '🍉', '⭐', '💎', '7️⃣', '🔔', '🍀'];
function handleSlots(interaction) {
  const minBet = parseInt(getSetting('min_bet'));
  const embed = createEmbed('🎰 ماكينات الحظ', 'اختر مبلغ رهانك!', '#E67E22');
  const buttons = [new ButtonBuilder().setCustomId(`slots_${minBet}`).setLabel(formatCoins(minBet)).setStyle(ButtonStyle.Primary)];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

function spinSlots(betAmount, userId) {
  const s1 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
  const s2 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
  const s3 = slotSymbols[Math.floor(Math.random() * slotSymbols.length)];
  let won = s1 === s2 && s2 === s3;
  let multiplier = won ? 10 : (s1 === s2 || s2 === s3 || s1 === s3 ? 2 : 0);
  return { result: `${s1} | ${s2} | ${s3}`, won: multiplier > 0, winnings: betAmount * multiplier };
}

// 🎲 DICE
function handleDice(interaction) {
  const embed = createEmbed('🎲 لعبة النرد', 'رهان على المجموع:\n📉 منخفض (2-6)\n⚖️ وسط (7)\n📈 عالي (8-12)', '#9B59B6');
  const buttons = [
    new ButtonBuilder().setCustomId('dice_low').setLabel('📉 2-6').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dice_middle').setLabel('⚖️ 7').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('dice_high').setLabel('📈 8-12').setStyle(ButtonStyle.Primary),
  ];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ✂️ RPS
function handleRPS(interaction) {
  const embed = createEmbed('✂️ حجرة ورقة مقص', 'اختر حركتك!', '#F39C12');
  const buttons = [
    new ButtonBuilder().setCustomId('rps_rock').setLabel('🪨 حجرة').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rps_paper').setLabel('📄 ورقة').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rps_scissors').setLabel('✂️ مقص').setStyle(ButtonStyle.Primary),
  ];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// 📝 WORD GUESS
const wordList = [{ word: 'حاسوب', hint: 'جهاز إلكتروني' }, { word: 'شمس', hint: 'نجم يضيء الأرض' }];
function handleWord(interaction) {
  const game = wordList[Math.floor(Math.random() * wordList.length)];
  activeGames.set(`${interaction.user.id}_word`, { word: game.word });
  const modal = new ModalBuilder().setCustomId('word_guess').setTitle('📝 تخمين الكلمة');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guess').setLabel(`تلميح: ${game.hint}`).setStyle(TextInputStyle.Short)));
  interaction.showModal(modal);
}

// 🔢 MATH
function handleMath(interaction) {
  const a = Math.floor(Math.random() * 50), b = Math.floor(Math.random() * 50);
  const ans = a + b;
  activeGames.set(`${interaction.user.id}_math`, { answer: ans.toString() });
  const embed = createEmbed('🔢 الحساب السريع', `${a} + ${b} = ?`, '#3498DB');
  const opts = [ans, ans + 5, ans - 3, ans + 10].sort(() => Math.random() - 0.5);
  const buttons = opts.map(o => new ButtonBuilder().setCustomId(`math_${o}`).setLabel(o.toString()).setStyle(ButtonStyle.Primary));
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// 🧩 MEMORY
function handleMemory(interaction) {
  const cards = ['🍎', '🍎', '🍊', '🍊', '🍇', '🍇'].sort(() => Math.random() - 0.5);
  activeGames.set(`${interaction.user.id}_memory`, { cards });
  const embed = createEmbed('🧩 الذاكرة', 'تذكر أماكن الفواكه!\n🍎 🍊 🍇\n🍇 🍊 🍎\n(اختر رقم البطاقة 1-6)', '#9B59B6');
  const modal = new ModalBuilder().setCustomId('memory_pick').setTitle('🧩 اختر بطاقة');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pick_number').setLabel('رقم البطاقة').setStyle(TextInputStyle.Short)));
  interaction.showModal(modal);
}

// ⚔️ FIGHT
const fightOpponents = [{ name: 'غول', emoji: '👹', hp: 100, atk: 10 }];
function handleFight(interaction) {
  const opp = fightOpponents[0];
  activeGames.set(`${interaction.user.id}_fight`, { pHP: 100, oHP: opp.hp, oAtk: opp.atk, oName: opp.name });
  const embed = createEmbed('⚔️ قتال', `أنت ❤️ 100 | ${opp.emoji} ${opp.name} ❤️ ${opp.hp}`, '#E74C3C');
  const buttons = [new ButtonBuilder().setCustomId('fight_attack').setLabel('⚔️ هجوم').setStyle(ButtonStyle.Danger)];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// 🪙 COINFLIP
function handleCoinflip(interaction) {
  const embed = createEmbed('🪙 رمي العملة', 'اختر وجه العملة!', '#F1C40F');
  const buttons = [
    new ButtonBuilder().setCustomId('coin_heads').setLabel('👑 وجه').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('coin_tails').setLabel('🪙 صورة').setStyle(ButtonStyle.Primary),
  ];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// 🐍 SNAKE
function handleSnake(interaction) {
  const snake = [[3,3]];
  const food = [1,1];
  activeGames.set(`${interaction.user.id}_snake`, { snake, food, score: 0 });
  const embed = createEmbed('🐍 الثعبان', 'استخدم الأزرار للتحكم!', '#27AE60');
  const buttons = [new ButtonBuilder().setCustomId('snake_up').setLabel('⬆️').setStyle(ButtonStyle.Primary)];
  interaction.reply({ embeds: [embed], components: [createButtons(...buttons)] });
}

// ═══════════════════════════════════════════════════════════
// INTERACTION HANDLERS (BUTTONS, MODALS)
// ═══════════════════════════════════════════════════════════

async function handleButtonInteraction(interaction) {
  const id = interaction.customId;
  const userId = interaction.user.id;

  if (id.startsWith('shop_buy_')) {
    const itemId = parseInt(id.replace('shop_buy_', ''));
    const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(itemId);
    const user = getUser(userId);
    if (user.coins < item.price) return interaction.reply({ content: '❌ رصيد غير كافٍ', ephemeral: true });
    updateCoins(userId, -item.price);
    let inv = JSON.parse(user.inventory); inv.push(item.name);
    db.prepare('UPDATE users SET inventory = ? WHERE id = ?').run(JSON.stringify(inv), userId);
    return interaction.reply({ content: `✅ اشتريت ${item.name}!` });
  }

  if (id.startsWith('roulette_')) {
    const type = id.replace('roulette_', '');
    if (type === 'number') {
      const modal = new ModalBuilder().setCustomId('roulette_number_modal').setTitle('🔢 اختر رقم');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roulette_bet_amount').setLabel('المبلغ').setStyle(TextInputStyle.Short)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roulette_number_value').setLabel('الرقم (0-36)').setStyle(TextInputStyle.Short))
      );
      return interaction.showModal(modal);
    }
    activeGames.set(`${userId}_roulette_type`, type);
    const modal = new ModalBuilder().setCustomId('roulette_bet_modal').setTitle('💰 مبلغ الرهان');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roulette_bet_amount').setLabel('المبلغ').setStyle(TextInputStyle.Short)));
    return interaction.showModal(modal);
  }

  if (id.startsWith('slots_')) {
    const bet = parseInt(id.replace('slots_', ''));
    const res = spinSlots(bet, userId);
    if (res.won) updateCoins(userId, res.winnings); else updateCoins(userId, -bet);
    return interaction.reply({ content: `${res.result}\n${res.won ? '🎉 فزت!' : '😔 خسرت'}` });
  }

  if (id.startsWith('bj_')) {
    const game = activeGames.get(`${userId}_blackjack`);
    if (!game) return;
    if (id === 'bj_hit') {
      game.playerHand.push(game.deck.pop());
      return updateBlackjackDisplay(interaction, game, false);
    } else {
      while (handTotal(game.dealerHand) < 17) game.dealerHand.push(game.deck.pop());
      const pT = handTotal(game.playerHand), dT = handTotal(game.dealerHand);
      let win = pT <= 21 && (dT > 21 || pT > dT);
      if (win) updateCoins(userId, game.betAmount * 2);
      activeGames.delete(`${userId}_blackjack`);
      return interaction.reply({ content: `الموزع: ${dT}, أنت: ${pT}. ${win ? '🎉 فزت!' : '😔 خسرت'}` });
    }
  }

  if (id.startsWith('math_')) {
    const sel = id.replace('math_', ''), game = activeGames.get(`${userId}_math`);
    if (sel === game.answer) { updateCoins(userId, 100); interaction.reply('✅ صح!'); }
    else interaction.reply('❌ خطأ!');
    activeGames.delete(`${userId}_math`);
  }

  if (id.startsWith('rps_')) {
    const p = id.replace('rps_', ''), choices = ['rock', 'paper', 'scissors'], b = choices[Math.floor(Math.random()*3)];
    let win = (p==='rock'&&b==='scissors') || (p==='paper'&&b==='rock') || (p==='scissors'&&b==='paper');
    if (win) updateCoins(userId, 50);
    interaction.reply(`أنت: ${p}, البوت: ${b}. ${win ? '🎉 فزت!' : (p===b ? '🤝 تعادل' : '😔 خسرت')}`);
  }

  if (id.startsWith('fight_')) {
    const game = activeGames.get(`${userId}_fight`);
    const dmg = 20; game.oHP -= dmg; game.pHP -= game.oAtk;
    if (game.oHP <= 0) { updateCoins(userId, 200); interaction.reply('🎉 قتلت الوحش!'); activeGames.delete(`${userId}_fight`); }
    else if (game.pHP <= 0) { interaction.reply('💀 مت في المعركة!'); activeGames.delete(`${userId}_fight`); }
    else interaction.reply(`ضربت الوحش! وحش: ❤️ ${game.oHP}, أنت: ❤️ ${game.pHP}`);
  }
}

async function handleModalInteraction(interaction) {
  const id = interaction.customId, userId = interaction.user.id;

  if (id === 'blackjack_bet') {
    const bet = parseInt(interaction.fields.getTextInputValue('bet_amount'));
    startBlackjackGame(interaction, bet);
  }

  if (id === 'roulette_bet_modal' || id === 'roulette_number_modal') {
    const bet = parseInt(interaction.fields.getTextInputValue('roulette_bet_amount'));
    const type = activeGames.get(`${userId}_roulette_type`);
    const val = id === 'roulette_number_modal' ? parseInt(interaction.fields.getTextInputValue('roulette_number_value')) : null;
    const res = spinRoulette(type || 'number', val, bet, userId);
    if (res.won) updateCoins(userId, res.winnings); else updateCoins(userId, -bet);
    interaction.reply(`النتيجة: ${res.result}. ${res.won ? '🎉 فزت!' : '😔 خسرت'}`);
  }

  if (id === 'word_guess') {
    const guess = interaction.fields.getTextInputValue('guess'), game = activeGames.get(`${userId}_word`);
    if (guess === game.word) { updateCoins(userId, 100); interaction.reply('🎉 صح!'); }
    else interaction.reply(`❌ خطأ! الكلمة كانت ${game.word}`);
  }
}

function handleSelectMenuInteraction(interaction) {}

// ═══════════════════════════════════════════════════════════
// ERROR HANDLING & LOGIN
// ═══════════════════════════════════════════════════════════
process.on('unhandledRejection', (r) => console.error(r));
process.on('uncaughtException', (e) => console.error(e));

client.login(TOKEN);
module.exports = { client, db };
