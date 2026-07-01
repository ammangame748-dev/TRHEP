const mongoose = require('mongoose');

const clanSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    clanIndex: { type: Number, required: true },
    clanName: { type: String, default: 'كلان بدون اسم' },
    leaderId: { type: String, default: null },
    roleId: { type: String, default: null },
    textChannelId: { type: String, default: null },
    voiceChannelId: { type: String, default: null },
    applyChannelId: { type: String, default: null },
    interviewChannelId: { type: String, default: null },
    resultsChannelId: { type: String, default: null },
    applyContent: { type: String, default: 'اضغط على الزر أدناه للتقديم' },
    pointsName: { type: String, default: 'نقاط' },
    questions: [{ type: String }],
    members: [{
        userId: String,
        points: { type: Number, default: 0 },
        messageCount: { type: Number, default: 0 },
        voiceMinutes: { type: Number, default: 0 }
    }],
    clanVaultPoints: { type: Number, default: 0 },
    blacklist: [{
        userId: String,
        until: Date,
        reason: String
    }],
    sessionToken: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

clanSchema.index({ guildId: 1, clanIndex: 1 }, { unique: true });

module.exports = mongoose.model('Clan', clanSchema);
