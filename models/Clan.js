const mongoose = require('mongoose');

const clanSchema = new mongoose.Schema({
    guildId: { type: String, required: true }, 
    clanIndex: { type: Number, required: true }, 
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
    
    // [تعديل 1] خزنة الكلان المستقلة الثابتة التي لا تتأثر بمغادرة الأعضاء
    clanVaultPoints: { type: Number, default: 0 },
    
    // [تعديل 2] مفتاح الأمان المشفر لمنع استغلال الأزرار المعلقة وقفل هوية القائد
    sessionToken: { type: String, default: '' },

    // [تعديل 3] المصفوفة الموحدة للأعضاء لتسهيل الفلترة والتصدر وتتبع الإحصائيات
    members: [{
        userId: { type: String, required: true },
        points: { type: Number, default: 0 },
        messageCount: { type: Number, default: 0 },
        voiceMinutes: { type: Number, default: 0 },
        joinDate: { type: Date, default: Date.now }
    }],

    // سجل حظر التقديم المؤقت للأعضاء المرفوضين لمنع الإغراق
    blacklist: [{
        userId: { type: String, required: true },
        until: { type: Date, required: true }
    }]
});

// منع تكرار نفس رقم الكلان داخل نفس السيرفر
clanSchema.index({ guildId: 1, clanIndex: 1 }, { unique: true });

module.exports = mongoose.model('Clan', clanSchema);
