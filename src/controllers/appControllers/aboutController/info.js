const mongoose = require('mongoose');
const { version } = require('../../../../package.json');

function formatUptime(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// GET /api/about/info — real system info instead of hardcoded strings on
// the About page: package.json's actual version, the real NODE_ENV, live
// server uptime, and a genuine count of registered admins.
const info = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const totalUsers = await Admin.countDocuments({ removed: false, enabled: true });

  return res.status(200).json({
    success: true,
    result: {
      version,
      environment: process.env.NODE_ENV || 'development',
      uptime: formatUptime(process.uptime()),
      totalUsers,
      license: 'Commercial',
    },
    message: 'Successfully found system info',
  });
};

module.exports = info;
