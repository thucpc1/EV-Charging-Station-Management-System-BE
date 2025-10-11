import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Tạo thư mục data nếu chưa có
const DATA_DIR = './data';
const SESSIONS_FILE = path.join(DATA_DIR, 'charging-sessions.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load dữ liệu từ file
const loadSessionsData = () => {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading sessions data:', error.message);
  }
  return [];
};

// Save dữ liệu vào file
const saveSessionsData = (data) => {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving sessions data:', error.message);
    return false;
  }
};

// Mock data for charging sessions
let mockChargingSessions = loadSessionsData();

// Auto-save mỗi 5 phút
setInterval(() => {
  saveSessionsData(mockChargingSessions);
}, 5 * 60 * 1000);

// Hàm đồng bộ với personal reports
const syncWithReports = async (userId, sessionData) => {
  try {
    const response = await fetch('http://localhost:5000/api/personal-reports/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionData })
    });
    return await response.json();
  } catch (error) {
    console.error('Error syncing with reports:', error.message);
    return { success: false };
  }
};

// GET /api/charging-sessions - Lấy tất cả phiên sạc
router.get('/', (req, res) => {
  try {
    const { userId, stationId, status, startDate, endDate } = req.query;
    let sessions = mockChargingSessions;
    
    // Lọc theo user ID
    if (userId) {
      sessions = sessions.filter(s => s.userId === userId);
    }
    
    // Lọc theo station ID
    if (stationId) {
      sessions = sessions.filter(s => s.stationId === stationId);
    }
    
    // Lọc theo status
    if (status) {
      sessions = sessions.filter(s => s.status === status);
    }
    
    // Lọc theo khoảng thời gian
    if (startDate || endDate) {
      sessions = sessions.filter(s => {
        const sessionDate = new Date(s.startTime);
        if (startDate && sessionDate < new Date(startDate)) return false;
        if (endDate && sessionDate > new Date(endDate)) return false;
        return true;
      });
    }
    
    // Sắp xếp theo thời gian bắt đầu (mới nhất trước)
    sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    
    res.json({
      success: true,
      data: sessions,
      total: sessions.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch charging sessions',
      message: error.message
    });
  }
});

// GET /api/charging-sessions/:id - Lấy phiên sạc cụ thể
router.get('/:id', (req, res) => {
  try {
    const session = mockChargingSessions.find(s => s.id === req.params.id);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Charging session not found'
      });
    }
    
    res.json({
      success: true,
      data: session
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch charging session',
      message: error.message
    });
  }
});

// POST /api/charging-sessions - Bắt đầu phiên sạc mới
router.post('/', async (req, res) => {
  try {
    const { userId, stationId, bookingId, connectorType, vehicleId } = req.body;
    
    // Validate required fields
    if (!userId || !stationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId and stationId'
      });
    }
    
    const newSession = {
      id: `session_${Date.now()}`,
      userId,
      stationId,
      bookingId,
      connectorType: connectorType || 'Type 2',
      vehicleId,
      status: 'active',
      startTime: new Date().toISOString(),
      endTime: null,
      energyDelivered: 0, // kWh
      duration: 0, // minutes
      cost: 0,
      powerRating: 22, // kW (default)
      currentPower: 0,
      batteryLevelStart: null,
      batteryLevelEnd: null,
      chargingSpeed: 'standard', // standard, fast, ultra_fast
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    mockChargingSessions.push(newSession);
    
    // Đồng bộ với personal reports
    await syncWithReports(userId, {
      sessionId: newSession.id,
      stationId: newSession.stationId,
      energyDelivered: newSession.energyDelivered,
      duration: newSession.duration,
      cost: newSession.cost,
      status: newSession.status,
      startTime: newSession.startTime,
      endTime: newSession.endTime
    });
    
    // Lưu vào lịch sử
    try {
      await fetch('http://localhost:5000/api/user-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          type: 'charging_session',
          data: {
            sessionId: newSession.id,
            stationId: newSession.stationId,
            status: 'started',
            startTime: newSession.startTime
          }
        })
      });
    } catch (error) {
      console.error('Error saving to history:', error.message);
    }
    
    res.status(201).json({
      success: true,
      data: newSession,
      message: 'Charging session started successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to start charging session',
      message: error.message
    });
  }
});

// PUT /api/charging-sessions/:id - Cập nhật phiên sạc
router.put('/:id', async (req, res) => {
  try {
    const sessionIndex = mockChargingSessions.findIndex(s => s.id === req.params.id);
    if (sessionIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Charging session not found'
      });
    }
    
    const currentSession = mockChargingSessions[sessionIndex];
    const updateData = req.body;
    
    // Nếu kết thúc phiên sạc
    if (updateData.status === 'completed' || updateData.status === 'cancelled') {
      const endTime = new Date().toISOString();
      const startTime = new Date(currentSession.startTime);
      const duration = Math.round((endTime - startTime) / 60000); // minutes
      
      updateData.endTime = endTime;
      updateData.duration = duration;
      updateData.currentPower = 0;
      
      // Tính toán chi phí dựa trên năng lượng đã sạc và giá của trạm
      if (updateData.energyDelivered) {
        // Giả sử giá từ dữ liệu trạm (sẽ lấy từ bảng stations)
        const pricePerKwh = 0.35; // Giá mặc định
        updateData.cost = updateData.energyDelivered * pricePerKwh;
      }
    }
    
    mockChargingSessions[sessionIndex] = {
      ...currentSession,
      ...updateData,
      updatedAt: new Date().toISOString()
    };
    
    // Đồng bộ với personal reports
    await syncWithReports(currentSession.userId, {
      sessionId: currentSession.id,
      stationId: currentSession.stationId,
      energyDelivered: updateData.energyDelivered || currentSession.energyDelivered,
      duration: updateData.duration || currentSession.duration,
      cost: updateData.cost || currentSession.cost,
      status: updateData.status || currentSession.status,
      startTime: currentSession.startTime,
      endTime: updateData.endTime || currentSession.endTime
    });
    
    // Lưu tiến trình vào lịch sử
    try {
      await fetch('http://localhost:5000/api/user-history/track-charging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.id,
          userId: currentSession.userId,
          progressData: {
            energyDelivered: updateData.energyDelivered || currentSession.energyDelivered,
            duration: updateData.duration || currentSession.duration,
            cost: updateData.cost || currentSession.cost,
            status: updateData.status || currentSession.status,
            batteryLevel: updateData.batteryLevelEnd,
            currentPower: updateData.currentPower
          }
        })
      });
    } catch (error) {
      console.error('Error tracking progress:', error.message);
    }
    
    res.json({
      success: true,
      data: mockChargingSessions[sessionIndex],
      message: 'Charging session updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update charging session',
      message: error.message
    });
  }
});

// DELETE /api/charging-sessions/:id - Hủy phiên sạc
router.delete('/:id', async (req, res) => {
  try {
    const sessionIndex = mockChargingSessions.findIndex(s => s.id === req.params.id);
    if (sessionIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Charging session not found'
      });
    }
    
    const currentSession = mockChargingSessions[sessionIndex];
    
    // Đánh dấu là đã hủy thay vì xóa
    mockChargingSessions[sessionIndex].status = 'cancelled';
    mockChargingSessions[sessionIndex].endTime = new Date().toISOString();
    mockChargingSessions[sessionIndex].updatedAt = new Date().toISOString();
    
    // Lưu vào lịch sử
    try {
      await fetch('http://localhost:5000/api/user-history/complete-charging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSession.id,
          userId: currentSession.userId,
          finalData: {
            status: 'cancelled',
            endTime: new Date().toISOString(),
            energyDelivered: currentSession.energyDelivered,
            duration: currentSession.duration,
            cost: currentSession.cost
          }
        })
      });
    } catch (error) {
      console.error('Error saving completion:', error.message);
    }
    
    res.json({
      success: true,
      data: mockChargingSessions[sessionIndex],
      message: 'Charging session cancelled successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cancel charging session',
      message: error.message
    });
  }
});

// GET /api/charging-sessions/active/:userId - Lấy phiên sạc đang hoạt động
router.get('/active/:userId', (req, res) => {
  try {
    const activeSession = mockChargingSessions.find(
      s => s.userId === req.params.userId && s.status === 'active'
    );
    
    if (!activeSession) {
      return res.status(404).json({
        success: false,
        error: 'No active charging session found'
      });
    }
    
    res.json({
      success: true,
      data: activeSession
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active charging session',
      message: error.message
    });
  }
});

export default router;


