const mongoose = require('mongoose');

const clanSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    clanIndex: { type: Number, required: true },
    leaderId: { type: String, default: null },
    clanName: { type: String, default: 'كلان جديد' },
    roleId: { type: String, default: null },
    textChannelId: { type: String, default: null },
    voiceChannelId: { type: String, default: null },
    applyChannelId: { type: String, default: null },
    resultsChannelId: { type: String, default: null },
    applyContent: { type: String, default: 'اضغط على الزر أدناه للتقديم.' },
    pointsName: { type: String, default: 'نقطة' },
    questions: { type: [String], default: [] },
    sessionToken: { type: String, default: null },
    members: [
        {
            userId: { type: String, required: true },
            points: { type: Number, default: 0 },
            messageCount: { type: Number, default: 0 },
            voiceMinutes: { type: Number, default: 0 },
        },
    ],
    blacklist: [
        {
            userId: { type: String, required: true },
            until: { type: Date, required: true },
        },
    ],
    clanVaultPoints: { type: Number, default: 0 },
});

clanSchema.index({ guildId: 1, clanIndex: 1 }, { unique: true });

module.exports = mongoose.model('Clan', clanSchema);
