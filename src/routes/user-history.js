    import express from 'express';
    import fs from 'fs';
    import path from 'path';

    const router = express.Router();

    // Tạo thư mục data nếu chưa có
    const DATA_DIR = './data';
    const HISTORY_FILE = path.join(DATA_DIR, 'user-history.json');

    if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Load dữ liệu từ file
    const loadHistoryData = () => {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading history data:', error.message);
    }
    return [];
    };

    // Save dữ liệu vào file
    const saveHistoryData = (data) => {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving history data:', error.message);
        return false;
    }
    };

    // Mock data for user history
    let mockUserHistory = loadHistoryData();

    // Auto-save mỗi 5 phút
    setInterval(() => {
    saveHistoryData(mockUserHistory);
    }, 5 * 60 * 1000);

    // Hàm tự động lưu lịch sử
    const autoSaveHistory = (userId, type, data) => {
    const historyEntry = {
        id: `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type,
        timestamp: new Date().toISOString(),
        data: {
        ...data,
        savedAt: new Date().toISOString()
        }
    };
    
    mockUserHistory.push(historyEntry);
    
    // Giới hạn 1000 entries per user để tránh memory issues
    const userEntries = mockUserHistory.filter(h => h.userId === userId);
    if (userEntries.length > 1000) {
        const toRemove = userEntries.slice(0, userEntries.length - 1000);
        toRemove.forEach(entry => {
        const index = mockUserHistory.findIndex(h => h.id === entry.id);
        if (index > -1) mockUserHistory.splice(index, 1);
        });
    }
    
    return historyEntry;
    };

// Track tiến trình sạc (sẽ được gọi từ external system)
const trackChargingProgress = (sessionId, userId, progressData) => {
  return autoSaveHistory(userId, 'charging_progress', {
    sessionId,
    ...progressData,
    progressType: 'real_time_update'
  });
};

// Track hoàn thành phiên sạc (sẽ được gọi từ external system)
const trackChargingComplete = (sessionId, userId, finalData) => {
  return autoSaveHistory(userId, 'charging_complete', {
    sessionId,
    ...finalData,
    completionType: 'session_ended'
  });
};

    // Track hành vi người dùng
    const trackUserBehavior = (userId, behaviorType, data) => {
    return autoSaveHistory(userId, 'user_behavior', {
        behaviorType,
        ...data,
        trackedAt: new Date().toISOString()
    });
    };

    // GET /api/user-history/:userId - Lấy lịch sử đầy đủ của người dùng
    router.get('/:userId', (req, res) => {
    try {
        const { userId } = req.params;
        const { type, startDate, endDate, limit = 50, offset = 0 } = req.query;
        
        let history = mockUserHistory.filter(h => h.userId === userId);
        
        // Lọc theo loại (booking, charging, payment, etc.)
        if (type) {
        history = history.filter(h => h.type === type);
        }
        
        // Lọc theo khoảng thời gian
        if (startDate || endDate) {
        history = history.filter(h => {
            const eventDate = new Date(h.timestamp);
            if (startDate && eventDate < new Date(startDate)) return false;
            if (endDate && eventDate > new Date(endDate)) return false;
            return true;
        });
        }
        
        // Sắp xếp theo thời gian (mới nhất trước)
        history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Phân trang
        const total = history.length;
        const paginatedHistory = history.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
        
        res.json({
        success: true,
        data: paginatedHistory,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
        });
    } catch (error) {
        res.status(500).json({
        success: false,
        error: 'Failed to fetch user history',
        message: error.message
        });
    }
    });

    // GET /api/user-history/:userId/summary - Lấy tóm tắt sử dụng
    router.get('/:userId/summary', (req, res) => {
    try {
        const { userId } = req.params;
        const { period = '30d' } = req.query;
        
        const now = new Date();
        let startDate;
        
        switch (period) {
        case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case '90d':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
        case '1y':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
            break;
        default:
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        
        const userHistory = mockUserHistory.filter(
        h => h.userId === userId && new Date(h.timestamp) >= startDate
        );
        
        // Tính toán thống kê tóm tắt
        const summary = {
        period,
        totalSessions: userHistory.filter(h => h.type === 'charging_session').length,
        totalBookings: userHistory.filter(h => h.type === 'booking').length,
        totalEnergyDelivered: userHistory
            .filter(h => h.type === 'charging_session' && h.data.energyDelivered)
            .reduce((sum, h) => sum + h.data.energyDelivered, 0),
        totalCost: userHistory
            .filter(h => h.type === 'payment' && h.data.amount)
            .reduce((sum, h) => sum + h.data.amount, 0),
        averageSessionDuration: calculateAverageDuration(userHistory),
        mostUsedStation: getMostUsedStation(userHistory),
        favoriteTimeSlots: getFavoriteTimeSlots(userHistory),
        chargingEfficiency: calculateChargingEfficiency(userHistory),
        monthlyTrend: getMonthlyTrend(userHistory, period),
        carbonSaved: calculateCarbonSaved(userHistory)
        };
        
        res.json({
        success: true,
        data: summary
        });
    } catch (error) {
        res.status(500).json({
        success: false,
        error: 'Failed to fetch user summary',
        message: error.message
        });
    }
    });

    // GET /api/user-history/:userId/statistics - Lấy thống kê chi tiết
    router.get('/:userId/statistics', (req, res) => {
    try {
        const { userId } = req.params;
        const { startDate, endDate } = req.query;
        
        let history = mockUserHistory.filter(h => h.userId === userId);
        
        if (startDate || endDate) {
        history = history.filter(h => {
            const eventDate = new Date(h.timestamp);
            if (startDate && eventDate < new Date(startDate)) return false;
            if (endDate && eventDate > new Date(endDate)) return false;
            return true;
        });
        }
        
        const statistics = {
        chargingSessions: getChargingSessionStats(history),
        energyUsage: getEnergyUsageStats(history),
        costAnalysis: getCostAnalysisStats(history),
        timeAnalysis: getTimeAnalysisStats(history),
        stationUsage: getStationUsageStats(history),
        efficiencyMetrics: getEfficiencyMetrics(history),
        environmentalImpact: getEnvironmentalImpact(history)
        };
        
        res.json({
        success: true,
        data: statistics
        });
    } catch (error) {
        res.status(500).json({
        success: false,
        error: 'Failed to fetch user statistics',
        message: error.message
        });
    }
    });

    // POST /api/user-history - Thêm entry lịch sử mới
    router.post('/', (req, res) => {
    try {
        const { userId, type, data } = req.body;
        
        if (!userId || !type) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId and type'
        });
        }
        
        const newHistoryEntry = autoSaveHistory(userId, type, data);
        
        res.status(201).json({
        success: true,
        data: newHistoryEntry,
        message: 'History entry added successfully'
        });
    } catch (error) {
        res.status(500).json({
        success: false,
        error: 'Failed to add history entry',
        message: error.message
        });
    }
    });

    // POST /api/user-history/track-charging - Track tiến trình sạc
    router.post('/track-charging', (req, res) => {
    try {
        const { sessionId, userId, progressData } = req.body;
        
        if (!sessionId || !userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: sessionId and userId'
        });
        }
        
        const historyEntry = trackChargingProgress(sessionId, userId, progressData);
        
        res.status(201).json({
        success: true,
        data: historyEntry,
        message: 'Charging progress tracked successfully'
        });
    } catch (error) {
        res.status(500).json({
        success: false,
        error: 'Failed to track charging progress',
        message: error.message
        });
    }
    });

    // POST /api/user-history/complete-charging - Track hoàn thành sạc
    router.post('/complete-charging', (req, res) => {
    try {
        const { sessionId, userId, finalData } = req.body;
        
        if (!sessionId || !userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: sessionId and userId'
        });
        }
        
        const historyEntry = trackChargingComplete(sessionId, userId, finalData);
        
        res.status(201).json({
        success: true,
        data: historyEntry,
        message: 'Charging completion tracked successfully'
        });
    } catch (error) {
        res.status(500).json({
        success: false,
        error: 'Failed to track charging completion',
        message: error.message
        });
    }
    });

    // POST /api/user-history/track-behavior - Track hành vi người dùng
    router.post('/track-behavior', (req, res) => {
    try {
        const { userId, behaviorType, data } = req.body;
        
        if (!userId || !behaviorType) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: userId and behaviorType'
        });
        }
        
        const historyEntry = trackUserBehavior(userId, behaviorType, data);
        
        res.status(201).json({
        success: true,
        data: historyEntry,
        message: 'User behavior tracked successfully'
        });
    } catch (error) {
        res.status(500).json({
        success: false,
        error: 'Failed to track user behavior',
        message: error.message
        });
    }
    });

    // Helper functions
    function calculateAverageDuration(history) {
    const sessions = history.filter(h => h.type === 'charging_session' && h.data.duration);
    if (sessions.length === 0) return 0;
    
    const totalDuration = sessions.reduce((sum, h) => sum + h.data.duration, 0);
    return Math.round(totalDuration / sessions.length);
    }

    function getMostUsedStation(history) {
    const stationCounts = {};
    history
        .filter(h => h.type === 'charging_session' && h.data.stationId)
        .forEach(h => {
        stationCounts[h.data.stationId] = (stationCounts[h.data.stationId] || 0) + 1;
        });
    
    const mostUsed = Object.entries(stationCounts)
        .sort(([,a], [,b]) => b - a)[0];
    
    return mostUsed ? { stationId: mostUsed[0], count: mostUsed[1] } : null;
    }

    function getFavoriteTimeSlots(history) {
    const hourCounts = {};
    history
        .filter(h => h.type === 'charging_session')
        .forEach(h => {
        const hour = new Date(h.timestamp).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });
    
    return Object.entries(hourCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([hour, count]) => ({ hour: parseInt(hour), count }));
    }

    function calculateChargingEfficiency(history) {
    const sessions = history.filter(h => 
        h.type === 'charging_session' && 
        h.data.energyDelivered && 
        h.data.duration
    );
    
    if (sessions.length === 0) return 0;
    
    const totalEnergy = sessions.reduce((sum, h) => sum + h.data.energyDelivered, 0);
    const totalDuration = sessions.reduce((sum, h) => sum + h.data.duration, 0);
    
    return totalDuration > 0 ? Math.round((totalEnergy / totalDuration) * 60) : 0; // kWh/hour
    }

    function calculateCarbonSaved(history) {
    const sessions = history.filter(h => 
        h.type === 'charging_session' && h.data.energyDelivered
    );
    
    const totalEnergy = sessions.reduce((sum, h) => sum + h.data.energyDelivered, 0);
    return totalEnergy * 0.4; // 0.4 kg CO2 per kWh
    }

    function getMonthlyTrend(history, period) {
    const months = {};
    history
        .filter(h => h.type === 'charging_session')
        .forEach(h => {
        const month = new Date(h.timestamp).toISOString().substring(0, 7); // YYYY-MM
        if (!months[month]) {
            months[month] = { sessions: 0, energy: 0, cost: 0 };
        }
        months[month].sessions++;
        if (h.data.energyDelivered) months[month].energy += h.data.energyDelivered;
        if (h.data.cost) months[month].cost += h.data.cost;
        });
    
    return Object.entries(months)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({ month, ...data }));
    }

    function getChargingSessionStats(history) {
    const sessions = history.filter(h => h.type === 'charging_session');
    return {
        total: sessions.length,
        completed: sessions.filter(h => h.data.status === 'completed').length,
        cancelled: sessions.filter(h => h.data.status === 'cancelled').length,
        averageDuration: calculateAverageDuration(history),
        totalEnergy: sessions.reduce((sum, h) => sum + (h.data.energyDelivered || 0), 0),
        totalCost: sessions.reduce((sum, h) => sum + (h.data.cost || 0), 0)
    };
    }

    function getEnergyUsageStats(history) {
    const sessions = history.filter(h => h.type === 'charging_session' && h.data.energyDelivered);
    const energyValues = sessions.map(h => h.data.energyDelivered);
    
    return {
        total: energyValues.reduce((sum, val) => sum + val, 0),
        average: energyValues.length > 0 ? energyValues.reduce((sum, val) => sum + val, 0) / energyValues.length : 0,
        min: energyValues.length > 0 ? Math.min(...energyValues) : 0,
        max: energyValues.length > 0 ? Math.max(...energyValues) : 0
    };
    }

    function getCostAnalysisStats(history) {
    const sessions = history.filter(h => h.type === 'charging_session' && h.data.cost);
    const costValues = sessions.map(h => h.data.cost);
    
    return {
        total: costValues.reduce((sum, val) => sum + val, 0),
        average: costValues.length > 0 ? costValues.reduce((sum, val) => sum + val, 0) / costValues.length : 0,
        min: costValues.length > 0 ? Math.min(...costValues) : 0,
        max: costValues.length > 0 ? Math.max(...costValues) : 0
    };
    }

    function getTimeAnalysisStats(history) {
    const sessions = history.filter(h => h.type === 'charging_session');
    const hourCounts = {};
    const dayCounts = {};
    
    sessions.forEach(h => {
        const date = new Date(h.timestamp);
        const hour = date.getHours();
        const day = date.getDay(); // 0 = Sunday
        
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    
    return {
        peakHours: Object.entries(hourCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([hour, count]) => ({ hour: parseInt(hour), count })),
        dayDistribution: Object.entries(dayCounts)
        .map(([day, count]) => ({ 
            day: parseInt(day), 
            dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseInt(day)],
            count 
        }))
        .sort((a, b) => a.day - b.day)
    };
    }

    function getStationUsageStats(history) {
    const stationCounts = {};
    const stationEnergy = {};
    const stationCost = {};
    
    history
        .filter(h => h.type === 'charging_session' && h.data.stationId)
        .forEach(h => {
        const stationId = h.data.stationId;
        stationCounts[stationId] = (stationCounts[stationId] || 0) + 1;
        stationEnergy[stationId] = (stationEnergy[stationId] || 0) + (h.data.energyDelivered || 0);
        stationCost[stationId] = (stationCost[stationId] || 0) + (h.data.cost || 0);
        });
    
    return Object.keys(stationCounts).map(stationId => ({
        stationId,
        sessions: stationCounts[stationId],
        totalEnergy: stationEnergy[stationId],
        totalCost: stationCost[stationId]
    })).sort((a, b) => b.sessions - a.sessions);
    }

    function getEfficiencyMetrics(history) {
    const sessions = history.filter(h => 
        h.type === 'charging_session' && 
        h.data.energyDelivered && 
        h.data.duration &&
        h.data.duration > 0
    );
    
    if (sessions.length === 0) {
        return { averageEfficiency: 0, bestEfficiency: 0, worstEfficiency: 0 };
    }
    
    const efficiencies = sessions.map(h => 
        (h.data.energyDelivered / h.data.duration) * 60 // kWh/hour
    );
    
    return {
        averageEfficiency: efficiencies.reduce((sum, eff) => sum + eff, 0) / efficiencies.length,
        bestEfficiency: Math.max(...efficiencies),
        worstEfficiency: Math.min(...efficiencies)
    };
    }

    function getEnvironmentalImpact(history) {
    const sessions = history.filter(h => h.type === 'charging_session' && h.data.energyDelivered);
    const totalEnergy = sessions.reduce((sum, h) => sum + h.data.energyDelivered, 0);
    
    return {
        totalEnergy,
        co2Saved: totalEnergy * 0.4, // kg CO2
        gasolineSaved: (totalEnergy * 4) / 30, // gallons (4 miles per kWh, 30 mpg)
        treesEquivalent: (totalEnergy * 0.4) / 22, // 1 tree absorbs ~22 kg CO2 per year
        cleanMiles: totalEnergy * 4 // miles
    };
    }

    export default router;
