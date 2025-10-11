import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Tạo thư mục data nếu chưa có
const DATA_DIR = './data';
const REPORTS_FILE = path.join(DATA_DIR, 'personal-reports.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load dữ liệu từ file
const loadReportsData = () => {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      const data = fs.readFileSync(REPORTS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading reports data:', error.message);
  }
  return [];
};

// Save dữ liệu vào file
const saveReportsData = (data) => {
  try {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving reports data:', error.message);
    return false;
  }
};

// Mock data for personal reports
let mockReports = loadReportsData();

// Auto-save mỗi 5 phút
setInterval(() => {
  saveReportsData(mockReports);
}, 5 * 60 * 1000);

// Helper functions
const calculateStartDate = (now, period) => {
  switch (period) {
    case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d': return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case '6m': return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    case '1y': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    default: return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
};

const calculateAverage = (values) => {
  const validValues = values.filter(v => v > 0);
  return validValues.length > 0 ? validValues.reduce((sum, v) => sum + v, 0) / validValues.length : 0;
};

// Aggregate user data
const aggregateUserData = (userId, period) => {
  const startDate = calculateStartDate(new Date(), period);
  
  const userSessions = mockReports.filter(
    r => r.userId === userId && 
         r.type === 'charging_session' && 
         new Date(r.timestamp) >= startDate
  );
  
  return {
    sessions: userSessions,
    totalEnergy: userSessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0),
    totalCost: userSessions.reduce((sum, s) => sum + (s.cost || 0), 0),
    totalDuration: userSessions.reduce((sum, s) => sum + (s.duration || 0), 0),
    averageEfficiency: calculateAverageEfficiency(userSessions),
    carbonSaved: userSessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0) * 0.4
  };
};

const calculateAverageEfficiency = (sessions) => {
  const validSessions = sessions.filter(s => 
    s.energyDelivered && s.duration && s.duration > 0
  );
  
  if (validSessions.length === 0) return 0;
  
  const totalEfficiency = validSessions.reduce((sum, session) => {
    const efficiency = (session.energyDelivered / session.duration) * 60; // kWh/hour
    return sum + efficiency;
  }, 0);
  
  return totalEfficiency / validSessions.length;
};

// GET /api/personal-reports/:userId/dashboard - Dashboard tổng quan
router.get('/:userId/dashboard', (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '30d' } = req.query;
    
    // Lấy dữ liệu tổng hợp
    const userData = aggregateUserData(userId, period);
    const trends = analyzeTrends(userData.sessions, period);
    const predictions = generatePredictions(userData.sessions, period);
    
    const dashboard = {
      period,
      generatedAt: new Date().toISOString(),
      overview: {
        totalSessions: userData.sessions.length,
        totalEnergyDelivered: userData.totalEnergy,
        totalCost: userData.totalCost,
        averageSessionDuration: userData.sessions.length > 0 
          ? userData.totalDuration / userData.sessions.length 
          : 0,
        totalChargingTime: userData.totalDuration,
        averageEfficiency: userData.averageEfficiency,
        carbonSaved: userData.carbonSaved
      },
      trends: {
        data: trends,
        energyTrend: trends.map(t => ({ period: t.period, value: t.energy })),
        costTrend: trends.map(t => ({ period: t.period, value: t.cost })),
        efficiencyTrend: trends.map(t => ({ period: t.period, value: t.efficiency })),
        sessionTrend: trends.map(t => ({ period: t.period, value: t.sessions }))
      },
      predictions: {
        nextPeriod: {
          energy: predictions.energyPrediction,
          cost: predictions.costPrediction,
          confidence: predictions.confidence
        },
        monthlyProjection: {
          energy: predictions.energyPrediction * 4, // 4 weeks
          cost: predictions.costPrediction * 4,
          confidence: predictions.confidence
        }
      },
      insights: generateAdvancedInsights(userData, trends, predictions),
      goals: getUserGoals(userId),
      achievements: getUserAchievements(userId),
      recommendations: generatePersonalizedRecommendations(userData.sessions)
    };
    
    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data',
      message: error.message
    });
  }
});

// GET /api/personal-reports/:userId/energy-report - Báo cáo năng lượng chi tiết
router.get('/:userId/energy-report', (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '30d', granularity = 'daily' } = req.query;
    
    const startDate = calculateStartDate(new Date(), period);
    const userSessions = mockReports.filter(
      r => r.userId === userId && 
           r.type === 'charging_session' && 
           new Date(r.timestamp) >= startDate
    );
    
    const energyReport = {
      period,
      granularity,
      summary: {
        totalEnergy: userSessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0),
        averagePerSession: calculateAverage(userSessions.map(s => s.energyDelivered || 0)),
        peakEnergyDay: getPeakEnergyDay(userSessions, granularity),
        energySavings: calculateEnergySavings(userSessions),
        carbonFootprintReduction: calculateCarbonReduction(userSessions)
      },
      breakdown: getEnergyBreakdown(userSessions, granularity),
      comparison: {
        previousPeriod: getPreviousPeriodComparison(userId, period, 'energy'),
        industryAverage: getIndustryAverage('energy'),
        personalBest: getPersonalBest(userId, 'energy')
      },
      recommendations: generateEnergyRecommendations(userSessions)
    };
    
    res.json({
      success: true,
      data: energyReport
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch energy report',
      message: error.message
    });
  }
});

// GET /api/personal-reports/:userId/cost-report - Báo cáo chi phí chi tiết
router.get('/:userId/cost-report', (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '30d' } = req.query;
    
    const startDate = calculateStartDate(new Date(), period);
    const userSessions = mockReports.filter(
      r => r.userId === userId && 
           r.type === 'charging_session' && 
           new Date(r.timestamp) >= startDate
    );
    
    const costReport = {
      period,
      summary: {
        totalCost: userSessions.reduce((sum, s) => sum + (s.cost || 0), 0),
        averageCostPerSession: calculateAverage(userSessions.map(s => s.cost || 0)),
        averageCostPerKwh: calculateCostPerKwh(userSessions),
        monthlyProjection: calculateMonthlyProjection(userSessions),
        yearlyProjection: calculateYearlyProjection(userSessions)
      },
      breakdown: {
        byStation: getCostBreakdownByStation(userSessions),
        byTimeOfDay: getCostBreakdownByTime(userSessions),
        byChargingSpeed: getCostBreakdownBySpeed(userSessions)
      },
      savings: {
        vsGasoline: calculateGasolineSavings(userSessions),
        vsPublicCharging: calculatePublicChargingSavings(userSessions),
        homeChargingSavings: calculateHomeChargingSavings(userSessions)
      },
      trends: {
        costTrend: getCostTrend(userSessions),
        priceTrend: getPriceTrend(userSessions),
        efficiencyTrend: getEfficiencyTrend(userSessions)
      },
      recommendations: generateCostRecommendations(userSessions)
    };
    
    res.json({
      success: true,
      data: costReport
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cost report',
      message: error.message
    });
  }
});

// GET /api/personal-reports/:userId/usage-patterns - Phân tích mẫu sử dụng
router.get('/:userId/usage-patterns', (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '90d' } = req.query;
    
    const startDate = calculateStartDate(new Date(), period);
    const userSessions = mockReports.filter(
      r => r.userId === userId && 
           r.type === 'charging_session' && 
           new Date(r.timestamp) >= startDate
    );
    
    const usagePatterns = {
      period,
      timePatterns: {
        hourlyDistribution: getHourlyDistribution(userSessions),
        dailyDistribution: getDailyDistribution(userSessions),
        monthlyDistribution: getMonthlyDistribution(userSessions),
        peakUsageTimes: getPeakUsageTimes(userSessions)
      },
      locationPatterns: {
        mostUsedStations: getMostUsedStations(userSessions),
        stationPreferences: getStationPreferences(userSessions),
        travelPatterns: getTravelPatterns(userSessions),
        homeVsAway: getHomeVsAwayPatterns(userSessions)
      },
      chargingPatterns: {
        sessionDurations: getSessionDurationPatterns(userSessions),
        energyLevels: getEnergyLevelPatterns(userSessions),
        chargingSpeeds: getChargingSpeedPatterns(userSessions),
        frequency: getChargingFrequencyPatterns(userSessions)
      },
      behavioralInsights: generateBehavioralInsights(userSessions),
      recommendations: generateUsageRecommendations(userSessions)
    };
    
    res.json({
      success: true,
      data: usagePatterns
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage patterns',
      message: error.message
    });
  }
});

// GET /api/personal-reports/:userId/sustainability - Báo cáo tác động môi trường
router.get('/:userId/sustainability', (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '1y' } = req.query;
    
    const startDate = calculateStartDate(new Date(), period);
    const userSessions = mockReports.filter(
      r => r.userId === userId && 
           r.type === 'charging_session' && 
           new Date(r.timestamp) >= startDate
    );
    
    const sustainabilityReport = {
      period,
      environmentalImpact: {
        co2EmissionsAvoided: calculateCO2Avoided(userSessions),
        gasolineSaved: calculateGasolineSaved(userSessions),
        treesEquivalent: calculateTreesEquivalent(userSessions),
        cleanMiles: calculateCleanMiles(userSessions)
      },
      renewableEnergy: {
        renewablePercentage: calculateRenewablePercentage(userSessions),
        solarEquivalent: calculateSolarEquivalent(userSessions),
        windEquivalent: calculateWindEquivalent(userSessions)
      },
      comparison: {
        vsGasolineVehicle: getGasolineComparison(userSessions),
        vsAverageEV: getAverageEVComparison(userSessions),
        vsPreviousYear: getPreviousYearComparison(userId, period)
      },
      achievements: getSustainabilityAchievements(userId),
      goals: getSustainabilityGoals(userId),
      recommendations: generateSustainabilityRecommendations(userSessions)
    };
    
    res.json({
      success: true,
      data: sustainabilityReport
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sustainability report',
      message: error.message
    });
  }
});

// GET /api/personal-reports/:userId/export - Xuất báo cáo toàn diện
router.get('/:userId/export', (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '30d', format = 'json' } = req.query;
    
    const comprehensiveReport = {
      userId,
      period,
      generatedAt: new Date().toISOString(),
      sections: [
        'dashboard',
        'energy-report', 
        'cost-report',
        'usage-patterns',
        'sustainability'
      ]
    };
    
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ev-report-${userId}-${period}.pdf"`);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="ev-report-${userId}-${period}.json"`);
    }
    
    res.json({
      success: true,
      data: comprehensiveReport
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to export report',
      message: error.message
    });
  }
});

// POST /api/personal-reports/sync - Đồng bộ dữ liệu từ external system
router.post('/sync', (req, res) => {
  try {
    const { userId, sessionData } = req.body;
    
    if (!userId || !sessionData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId and sessionData'
      });
    }
    
    // Tìm session hiện tại hoặc tạo mới
    const existingIndex = mockReports.findIndex(
      r => r.userId === userId && r.sessionId === sessionData.sessionId
    );
    
    if (existingIndex >= 0) {
      mockReports[existingIndex] = {
        ...mockReports[existingIndex],
        ...sessionData,
        updatedAt: new Date().toISOString()
      };
    } else {
      mockReports.push({
        id: `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type: 'charging_session',
        timestamp: new Date().toISOString(),
        ...sessionData
      });
    }
    
    res.json({
      success: true,
      message: 'Data synchronized successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to sync data',
      message: error.message
    });
  }
});

// POST /api/personal-reports/add-session - Thêm phiên sạc mới (cho external system)
router.post('/add-session', (req, res) => {
  try {
    const { userId, sessionData } = req.body;
    
    if (!userId || !sessionData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId and sessionData'
      });
    }
    
    const newSession = {
      id: `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      type: 'charging_session',
      timestamp: new Date().toISOString(),
      ...sessionData
    };
    
    mockReports.push(newSession);
    
    res.status(201).json({
      success: true,
      data: newSession,
      message: 'Session added successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to add session',
      message: error.message
    });
  }
});

// Helper functions for calculations
function analyzeTrends(sessions, period) {
  const now = new Date();
  const startDate = calculateStartDate(now, period);
  
  const timeGroups = {};
  sessions.forEach(session => {
    const sessionDate = new Date(session.timestamp);
    let groupKey;
    
    switch (period) {
      case '7d':
        groupKey = sessionDate.toISOString().substring(0, 10); // daily
        break;
      case '30d':
        groupKey = sessionDate.toISOString().substring(0, 7); // monthly
        break;
      case '90d':
        groupKey = getWeekNumber(sessionDate); // weekly
        break;
      default:
        groupKey = sessionDate.toISOString().substring(0, 10);
    }
    
    if (!timeGroups[groupKey]) {
      timeGroups[groupKey] = {
        sessions: 0,
        energy: 0,
        cost: 0,
        duration: 0
      };
    }
    
    timeGroups[groupKey].sessions++;
    timeGroups[groupKey].energy += session.energyDelivered || 0;
    timeGroups[groupKey].cost += session.cost || 0;
    timeGroups[groupKey].duration += session.duration || 0;
  });
  
  const trends = Object.entries(timeGroups)
    .map(([period, data]) => ({
      period,
      ...data,
      efficiency: data.duration > 0 ? (data.energy / data.duration) * 60 : 0
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
  
  return trends;
}

function generatePredictions(sessions, period) {
  const trends = analyzeTrends(sessions, period);
  
  if (trends.length < 2) {
    return {
      energyPrediction: 0,
      costPrediction: 0,
      confidence: 0
    };
  }
  
  // Simple linear regression for prediction
  const n = trends.length;
  const xValues = trends.map((_, index) => index);
  const yEnergy = trends.map(t => t.energy);
  const yCost = trends.map(t => t.cost);
  
  const slopeEnergy = calculateSlope(xValues, yEnergy);
  const slopeCost = calculateSlope(xValues, yCost);
  
  const nextPeriodEnergy = yEnergy[n-1] + slopeEnergy;
  const nextPeriodCost = yCost[n-1] + slopeCost;
  
  const energyVariance = calculateVariance(yEnergy);
  const costVariance = calculateVariance(yCost);
  const confidence = Math.max(0, 1 - (energyVariance + costVariance) / 100);
  
  return {
    energyPrediction: Math.max(0, nextPeriodEnergy),
    costPrediction: Math.max(0, nextPeriodCost),
    confidence: Math.round(confidence * 100)
  };
}

function calculateSlope(x, y) {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
}

function calculateVariance(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return variance;
}

function getWeekNumber(date) {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

function generateAdvancedInsights(userData, trends, predictions) {
  const insights = [];
  
  // Energy insights
  if (userData.totalEnergy > 100) {
    insights.push({
      type: 'energy',
      priority: 'positive',
      title: 'Mức sử dụng năng lượng cao',
      message: `Bạn đã sử dụng ${userData.totalEnergy.toFixed(1)} kWh trong kỳ này`,
      impact: 'positive'
    });
  }
  
  // Efficiency insights
  if (userData.averageEfficiency > 3.0) {
    insights.push({
      type: 'efficiency',
      priority: 'positive',
      title: 'Hiệu suất sạc tốt',
      message: `Hiệu suất sạc ${userData.averageEfficiency.toFixed(1)} kWh/h cao hơn mức trung bình`,
      impact: 'positive'
    });
  } else if (userData.averageEfficiency < 2.0) {
    insights.push({
      type: 'efficiency',
      priority: 'warning',
      title: 'Cần cải thiện hiệu suất',
      message: `Hiệu suất sạc ${userData.averageEfficiency.toFixed(1)} kWh/h thấp hơn mức trung bình`,
      impact: 'negative'
    });
  }
  
  // Cost insights
  const avgCostPerKwh = userData.totalEnergy > 0 ? userData.totalCost / userData.totalEnergy : 0;
  if (avgCostPerKwh > 0.4) {
    insights.push({
      type: 'cost',
      priority: 'warning',
      title: 'Chi phí sạc cao',
      message: `Chi phí trung bình ${avgCostPerKwh.toFixed(2)} $/kWh cao hơn mức trung bình`,
      impact: 'negative'
    });
  }
  
  return insights;
}

function generatePersonalizedRecommendations(sessions) {
  const recommendations = [];
  
  if (sessions.length === 0) {
    return [{
      type: 'getting_started',
      priority: 'high',
      title: 'Bắt đầu sử dụng xe điện',
      message: 'Bạn chưa có phiên sạc nào. Hãy tìm trạm sạc gần nhất để bắt đầu!',
      action: 'Tìm trạm sạc'
    }];
  }
  
  const avgDuration = sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / sessions.length;
  const avgEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0) / sessions.length;
  const avgCost = sessions.reduce((sum, s) => sum + (s.cost || 0), 0) / sessions.length;
  
  // Duration recommendations
  if (avgDuration > 120) {
    recommendations.push({
      type: 'duration',
      priority: 'medium',
      title: 'Tối ưu thời gian sạc',
      message: `Thời gian sạc trung bình ${avgDuration.toFixed(0)} phút khá dài`,
      action: 'Thử sạc nhanh hoặc sạc tại nhà'
    });
  }
  
  // Energy efficiency recommendations
  const efficiency = avgDuration > 0 ? (avgEnergy / avgDuration) * 60 : 0;
  if (efficiency < 2.0) {
    recommendations.push({
      type: 'efficiency',
      priority: 'high',
      title: 'Cải thiện hiệu suất sạc',
      message: `Hiệu suất ${efficiency.toFixed(1)} kWh/h thấp`,
      action: 'Sạc vào giờ thấp điểm hoặc kiểm tra thiết bị'
    });
  }
  
  // Cost optimization
  const costPerKwh = avgEnergy > 0 ? avgCost / avgEnergy : 0;
  if (costPerKwh > 0.35) {
    recommendations.push({
      type: 'cost',
      priority: 'medium',
      title: 'Tiết kiệm chi phí',
      message: `Chi phí ${costPerKwh.toFixed(2)} $/kWh cao`,
      action: 'Tìm trạm sạc có giá ưu đãi'
    });
  }
  
  return recommendations;
}

function getUserGoals(userId) {
  // Mock implementation - would come from user preferences
  return [
    { type: 'energy', target: 500, current: 320, unit: 'kWh', period: 'monthly' },
    { type: 'sessions', target: 20, current: 15, unit: 'sessions', period: 'monthly' },
    { type: 'cost', target: 100, current: 85, unit: 'USD', period: 'monthly' }
  ];
}

function getUserAchievements(userId) {
  // Mock implementation
  return [
    { id: 'first_charge', name: 'Lần sạc đầu tiên', earned: true, date: '2024-01-15' },
    { id: 'eco_driver', name: 'Tài xế thân thiện môi trường', earned: true, date: '2024-02-20' },
    { id: 'cost_saver', name: 'Tiết kiệm chi phí', earned: false, progress: 75 }
  ];
}

// Additional helper functions for reports
function getPeakEnergyDay(sessions, granularity) {
  return { date: '2024-03-15', energy: 45.2 };
}

function calculateEnergySavings(sessions) {
  return 25.5; // USD saved
}

function calculateCarbonReduction(sessions) {
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  return totalEnergy * 0.4; // kg CO2
}

function getEnergyBreakdown(sessions, granularity) {
  return [
    { period: 'Week 1', energy: 45.2 },
    { period: 'Week 2', energy: 38.7 },
    { period: 'Week 3', energy: 52.1 },
    { period: 'Week 4', energy: 41.8 }
  ];
}

function getPreviousPeriodComparison(userId, period, type) {
  return { current: 45.2, previous: 38.7, change: '+17%' };
}

function getIndustryAverage(type) {
  return { average: 35.5, user: 42.1, percentile: 75 };
}

function getPersonalBest(userId, type) {
  return { value: 52.1, date: '2024-03-15' };
}

function generateEnergyRecommendations(sessions) {
  return [
    'Sạc vào giờ thấp điểm để tiết kiệm chi phí',
    'Sử dụng sạc nhanh cho các chuyến đi dài',
    'Theo dõi mức pin để tối ưu hóa thời gian sạc'
  ];
}

function calculateCostPerKwh(sessions) {
  const totalCost = sessions.reduce((sum, s) => sum + (s.cost || 0), 0);
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  return totalEnergy > 0 ? totalCost / totalEnergy : 0;
}

function calculateMonthlyProjection(sessions) {
  const avgCost = calculateAverage(sessions.map(s => s.cost || 0));
  return avgCost * 30; // Rough monthly projection
}

function calculateYearlyProjection(sessions) {
  const monthlyProjection = calculateMonthlyProjection(sessions);
  return monthlyProjection * 12;
}

function getCostBreakdownByStation(sessions) {
  return [
    { stationId: 'station_001', cost: 45.2, sessions: 8 },
    { stationId: 'station_002', cost: 32.1, sessions: 5 }
  ];
}

function getCostBreakdownByTime(sessions) {
  return {
    peak: { cost: 25.5, sessions: 5 },
    offPeak: { cost: 51.8, sessions: 8 }
  };
}

function getCostBreakdownBySpeed(sessions) {
  return {
    standard: { cost: 35.2, sessions: 6 },
    fast: { cost: 28.7, sessions: 4 },
    ultraFast: { cost: 13.4, sessions: 3 }
  };
}

function calculateGasolineSavings(sessions) {
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  const milesEquivalent = totalEnergy * 4; // 4 miles per kWh
  const gasolineEquivalent = milesEquivalent / 30; // 30 mpg
  return gasolineEquivalent * 3.50; // $3.50 per gallon
}

function calculatePublicChargingSavings(sessions) {
  return 15.5;
}

function calculateHomeChargingSavings(sessions) {
  return 8.2;
}

function getCostTrend(sessions) {
  return { trend: 'decreasing', percentage: '-5%', averageCostPerKwh: 0.32 };
}

function getPriceTrend(sessions) {
  return { trend: 'stable', averagePrice: 0.32 };
}

function getEfficiencyTrend(sessions) {
  return { trend: 'improving', efficiency: 3.2 };
}

function generateCostRecommendations(sessions) {
  return [
    'Sử dụng sạc tại nhà vào ban đêm để tiết kiệm chi phí',
    'Tìm các trạm sạc có giá ưu đãi',
    'Sạc đầy pin trước khi đi để tránh sạc khẩn cấp đắt tiền'
  ];
}

function getHourlyDistribution(sessions) {
  const hourlyData = Array(24).fill(0);
  sessions.forEach(session => {
    const hour = new Date(session.timestamp).getHours();
    hourlyData[hour]++;
  });
  return hourlyData.map((count, hour) => ({ hour, count }));
}

function getDailyDistribution(sessions) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return dayNames.map((day, index) => ({
    day,
    count: Math.floor(Math.random() * 5) + 1
  }));
}

function getMonthlyDistribution(sessions) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months.map((month, index) => ({
    month,
    count: Math.floor(Math.random() * 10) + 5
  }));
}

function getPeakUsageTimes(sessions) {
  return [
    { time: '08:00-09:00', sessions: 15, type: 'morning_commute' },
    { time: '17:00-18:00', sessions: 18, type: 'evening_commute' },
    { time: '12:00-13:00', sessions: 8, type: 'lunch_break' }
  ];
}

function getMostUsedStations(sessions) {
  return [
    { stationId: 'station_001', name: 'Central Mall', sessions: 25, energy: 450 },
    { stationId: 'station_002', name: 'Airport Express', sessions: 18, energy: 320 }
  ];
}

function getStationPreferences(sessions) {
  return {
    preferredChargerType: 'fast',
    preferredAmenities: ['wifi', 'cafe'],
    averageDistance: 2.5 // km from home
  };
}

function getTravelPatterns(sessions) {
  return {
    homeStation: 'station_001',
    workStation: 'station_002',
    weekendStations: ['station_003', 'station_004'],
    travelRadius: 25 // km
  };
}

function getHomeVsAwayPatterns(sessions) {
  return {
    homeCharging: { sessions: 20, percentage: 65 },
    awayCharging: { sessions: 11, percentage: 35 }
  };
}

function getSessionDurationPatterns(sessions) {
  return {
    short: { duration: '< 30 min', sessions: 8, percentage: 26 },
    medium: { duration: '30-60 min', sessions: 15, percentage: 48 },
    long: { duration: '> 60 min', sessions: 8, percentage: 26 }
  };
}

function getEnergyLevelPatterns(sessions) {
  return {
    lowCharge: { level: '< 20%', sessions: 12, percentage: 39 },
    mediumCharge: { level: '20-80%', sessions: 16, percentage: 52 },
    highCharge: { level: '> 80%', sessions: 3, percentage: 9 }
  };
}

function getChargingSpeedPatterns(sessions) {
  return {
    standard: { sessions: 18, percentage: 58 },
    fast: { sessions: 10, percentage: 32 },
    ultraFast: { sessions: 3, percentage: 10 }
  };
}

function getChargingFrequencyPatterns(sessions) {
  return {
    daily: 0,
    weekly: 15,
    monthly: 16,
    irregular: 0
  };
}

function generateBehavioralInsights(sessions) {
  return [
    'Bạn thường sạc vào buổi sáng trước khi đi làm',
    'Trạm sạc Central Mall là lựa chọn yêu thích của bạn',
    'Bạn có xu hướng sạc đầy pin vào cuối tuần'
  ];
}

function generateUsageRecommendations(sessions) {
  return [
    'Thử sạc vào giờ thấp điểm để tiết kiệm chi phí',
    'Sử dụng sạc nhanh cho các chuyến đi xa',
    'Lên kế hoạch sạc trước để tránh chờ đợi'
  ];
}

function calculateCO2Avoided(sessions) {
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  return totalEnergy * 0.4; // kg CO2
}

function calculateGasolineSaved(sessions) {
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  return totalEnergy * 0.25; // gallons saved per kWh
}

function calculateTreesEquivalent(sessions) {
  const co2Avoided = calculateCO2Avoided(sessions);
  return co2Avoided / 22; // 1 tree absorbs ~22 kg CO2 per year
}

function calculateCleanMiles(sessions) {
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  return totalEnergy * 4; // 4 miles per kWh average
}

function calculateRenewablePercentage(sessions) {
  return 75; // percentage
}

function calculateSolarEquivalent(sessions) {
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  return totalEnergy * 0.1; // solar panels equivalent in kW
}

function calculateWindEquivalent(sessions) {
  const totalEnergy = sessions.reduce((sum, s) => sum + (s.energyDelivered || 0), 0);
  return totalEnergy * 0.05; // wind turbines equivalent
}

function getGasolineComparison(sessions) {
  return {
    co2Saved: calculateCO2Avoided(sessions),
    gasolineSaved: calculateGasolineSaved(sessions),
    costSaved: calculateGasolineSavings(sessions)
  };
}

function getAverageEVComparison(sessions) {
  return {
    energyEfficiency: '+15%',
    costEfficiency: '+8%',
    chargingFrequency: '-12%'
  };
}

function getPreviousYearComparison(userId, period) {
  return {
    co2Reduction: '+25%',
    energyUsage: '+18%',
    costSavings: '+12%'
  };
}

function getSustainabilityAchievements(userId) {
  return [
    { id: 'co2_warrior', name: 'Chiến binh CO2', earned: true, co2Saved: 150 },
    { id: 'eco_miles', name: 'Dặm xanh', earned: true, cleanMiles: 1000 },
    { id: 'tree_hugger', name: 'Người yêu cây', earned: false, progress: 85 }
  ];
}

function getSustainabilityGoals(userId) {
  return [
    { type: 'co2', target: 500, current: 320, unit: 'kg', period: 'yearly' },
    { type: 'cleanMiles', target: 5000, current: 3200, unit: 'miles', period: 'yearly' },
    { type: 'renewable', target: 80, current: 75, unit: '%', period: 'monthly' }
  ];
}

function generateSustainabilityRecommendations(sessions) {
  return [
    'Sử dụng năng lượng tái tạo cho sạc tại nhà',
    'Tham gia chương trình sạc xanh',
    'Chia sẻ xe điện với bạn bè để giảm tác động môi trường'
  ];
}

export default router;
