const mongoose = require('mongoose');

const clanSchema = new mongoose.Schema({
    clanIndex: { type: Number, required: true, unique: true }, // رقم الكلان من 1 إلى 8
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
        default: {}
    },
    messageCounters: {
        type: Map,
        of: Number,
        default: {}
    }
});

module.exports = mongoose.model('Clan', clanSchema);
