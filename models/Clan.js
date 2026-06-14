const mongoose = require('mongoose');

const clanSchema = new mongoose.Schema({
    guildId: { type: String, required: true }, // معرف السيرفر لضمان عمل البوت في أكثر من سيرفر
    clanIndex: { type: Number, required: true }, // رقم الكلان من 1 إلى 8
    leaderId: { type: String, default: '' },
    clanName: { type: String, default: '' },
    roleId: { type: String, default: '' },
    textChannelId: { type: String, default: '' },
    voiceChannelId: { type: String, default: '' },
    applyChannelId: { type: String, default: '' },
    interviewChannelId: { type: String, default: '' },
    resultsChannelId: { type: String, default: '' },
    applyContent: { type: String, default: '' },
    pointsName: { type: String, default: 'نقاط' },
    questions: {
        type: [String],
        default: ['السؤال الأول', 'السؤال الثاني', 'السؤال الثالث']
    },
    totalPoints: { type: Number, default: 0 },
    membersPoints: {
        type: Map,
        of: Number,
        default: new Map()
    },
    messageCounters: {
        type: Map,
        of: Number,
        default: new Map()
    }
});

// منع تكرار نفس رقم الكلان داخل نفس السيرفر
clanSchema.index({ guildId: 1, clanIndex: 1 }, { unique: true });

module.exports = mongoose.model('Clan', clanSchema);
