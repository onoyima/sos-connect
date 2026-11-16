package ng.sosconnect.meshnearby

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps the app process alive so the phone keeps relaying SOS and messages for people nearby while the
 * screen is off. The user turns this on in Settings ("Help relay alerts in the background"); Android
 * shows a permanent notification while it runs, as the platform requires.
 */
class MeshForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channelId = "sos_mesh"
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(channelId, "Offline relay", NotificationManager.IMPORTANCE_LOW))
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, channelId) else Notification.Builder(this)
    val notification = builder
      .setContentTitle(intent?.getStringExtra("title") ?: "SOS Connect")
      .setContentText(intent?.getStringExtra("text") ?: "Relaying alerts for people nearby")
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(4711, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(4711, notification)
    }
    return START_STICKY
  }
}
