const mongoose = require('mongoose');

const clanSchema = new mongoose.Schema({
    guildId: String,
    clanIndex: Number,
    leaderId: String,
    clanName: String,
    roleId: String,
    textChannelId: String,
    voiceChannelId: String,
    applyChannelId: String,
    interviewChannelId: String,
    resultsChannelId: String,
    applyContent: String,
    pointsName: { type: String, default: 'نقطة' },
    questions: [String],
    sessionToken: String,
    clanVaultPoints: { type: Number, default: 0 },
    members: [{
        userId: String,
        points: { type: Number, default: 0 },
        messageCount: { type: Number, default: 0 },
        voiceMinutes: { type: Number, default: 0 }
    }],
    blacklist: [{
        userId: String,
        until: Date
    }]
});

module.exports = mongoose.model('Clan', clanSchema);
