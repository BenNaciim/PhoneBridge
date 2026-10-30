package com.phonebridge

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var host: EditText
    private lateinit var code: EditText
    private lateinit var statusDot: View
    private lateinit var statusTitle: TextView
    private lateinit var statusSub: TextView
    private lateinit var chipNotifs: TextView
    private lateinit var chipBattery: TextView
    private class Perm(val perms: List<String>, val chip: TextView)
    private val permList = mutableListOf<Perm>()
    private val handler = Handler(Looper.getMainLooper())
    private val poll = object : Runnable {
        override fun run() {
            refreshStatus()
            handler.postDelayed(this, 1000)
        }
    }

    private val mint = Color.parseColor("#5DCAA5")
    private val mintInk = Color.parseColor("#04342C")
    private val amber = Color.parseColor("#FAC775")
    private val amberInk = Color.parseColor("#412402")
    private val coral = Color.parseColor("#F09595")
    private val soft = Color.parseColor("#C8FFFFFF")

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun shape(fill: Int, radiusDp: Int, strokeColor: Int = 0, strokeDp: Int = 0) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(radiusDp).toFloat()
        if (strokeDp > 0) setStroke(dp(strokeDp), strokeColor)
    }

    private fun ripple(bg: GradientDrawable) =
        RippleDrawable(ColorStateList.valueOf(Color.parseColor("#33FFFFFF")), bg, null)

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = shape(Color.parseColor("#26FFFFFF"), 20, Color.parseColor("#59FFFFFF"), 1)
        setPadding(dp(18), dp(16), dp(18), dp(18))
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) }
    }

    private fun title(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(Color.WHITE)
        textSize = 16f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }

    private fun hint(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(soft)
        textSize = 13f
        setPadding(0, dp(2), 0, dp(8))
    }

    private fun primary(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        setTextColor(mintInk)
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        stateListAnimator = null
        background = ripple(shape(mint, 16))
        layoutParams = LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) }
        setOnClickListener { onClick() }
    }

    private fun secondary(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        setTextColor(Color.WHITE)
        stateListAnimator = null
        background = ripple(shape(Color.parseColor("#1FFFFFFF"), 16, Color.parseColor("#66FFFFFF"), 1))
        layoutParams = LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(10) }
        setOnClickListener { onClick() }
    }

    private fun field(hintText: String, value: String, type: Int) = EditText(this).apply {
        hint = hintText
        setText(value)
        inputType = type
        setSingleLine()
        setTextColor(Color.WHITE)
        setHintTextColor(Color.parseColor("#99FFFFFF"))
        textSize = 15f
        background = shape(Color.parseColor("#2EFFFFFF"), 14, Color.parseColor("#66FFFFFF"), 1)
        setPadding(dp(14), 0, dp(14), 0)
        layoutParams = LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(8) }
    }

    private fun chip() = TextView(this).apply {
        textSize = 12f
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setPadding(dp(12), dp(5), dp(12), dp(5))
    }

    private fun permRow(label: String, chip: TextView, onClick: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = ripple(shape(Color.TRANSPARENT, 12))
        setPadding(0, dp(10), 0, dp(10))
        addView(TextView(context).apply {
            text = label
            setTextColor(Color.WHITE)
            textSize = 15f
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        })
        addView(chip)
        setOnClickListener { onClick() }
    }

    private fun setChip(c: TextView, ok: Boolean) {
        c.text = if (ok) "Activé" else "À activer"
        c.setTextColor(if (ok) mintInk else amberInk)
        c.background = shape(if (ok) mint else amber, 12)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(8), dp(18), dp(28))
        }

        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(TextView(this).apply {
            text = "PB"
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            background = shape(Color.parseColor("#33FFFFFF"), 16, Color.parseColor("#66FFFFFF"), 1)
            layoutParams = LinearLayout.LayoutParams(dp(46), dp(46))
        })
        val headText = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0) }
        headText.addView(TextView(this).apply { text = "PhoneBridge"; setTextColor(Color.WHITE); textSize = 24f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) })
        headText.addView(TextView(this).apply { text = "Votre téléphone sur votre PC"; setTextColor(soft); textSize = 13f })
        head.addView(headText)
        root.addView(head)

        val st = card()
        val stRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        statusDot = View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(12), dp(12)).apply { rightMargin = dp(12) } }
        val stText = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        statusTitle = title("")
        statusSub = TextView(this).apply { setTextColor(soft); textSize = 13f }
        stText.addView(statusTitle)
        stText.addView(statusSub)
        stRow.addView(statusDot)
        stRow.addView(stText)
        st.addView(stRow)
        root.addView(st)

        val perms = card()
        perms.addView(title("1. Autorisations"))
        perms.addView(hint("Touchez une ligne pour l'activer."))
        chipNotifs = chip()
        perms.addView(permRowFor("Lire les SMS", listOf(Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS)))
        perms.addView(permRowFor("Envoyer des SMS", listOf(Manifest.permission.SEND_SMS)))
        perms.addView(permRowFor("Contacts", listOf(Manifest.permission.READ_CONTACTS)))
        perms.addView(permRowFor("Journal d'appels", listOf(Manifest.permission.READ_CALL_LOG)))
        perms.addView(permRow("Accès aux notifications", chipNotifs) {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        })
        chipBattery = chip()
        perms.addView(permRow("Rester actif en arrière-plan", chipBattery) {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:$packageName"))
            )
        })
        root.addView(perms)

        val pair = card()
        pair.addView(title("2. Jumelage avec le PC"))
        pair.addView(hint("Même Wi-Fi que le PC. Scannez le QR code affiché sur l'écran."))
        pair.addView(primary("Scanner le QR code") { scan() })
        host = field("Adresse du PC (ex. 192.168.1.20:8787)", prefs.host, InputType.TYPE_TEXT_VARIATION_URI)
        val savedCode = if (prefs.token.isNotEmpty() && prefs.fp.isNotEmpty()) "${prefs.token}-${prefs.fp.uppercase()}" else ""
        code = field("Code de jumelage affiché sur le PC", savedCode, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS)
        pair.addView(host)
        pair.addView(code)
        pair.addView(secondary("Connecter") { connect() })
        pair.addView(secondary("Déconnecter") { disconnect() })
        root.addView(pair)

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#04342C"), Color.parseColor("#0C447C"), Color.parseColor("#26215C"))
            )
            addView(root)
            setOnApplyWindowInsetsListener { _, insets ->
                root.setPadding(dp(18), insets.systemWindowInsetTop + dp(8), dp(18), insets.systemWindowInsetBottom + dp(28))
                insets
            }
        }
        setContentView(scroll)

        if (prefs.enabled && prefs.host.isNotEmpty() && prefs.fp.isNotEmpty()) startBridge()
    }

    override fun onResume() {
        super.onResume()
        handler.post(poll)
    }

    override fun onPause() {
        handler.removeCallbacks(poll)
        super.onPause()
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun refreshStatus() {
        val (color, text, sub) = when {
            Relay.ready -> Triple(mint, "Connecté au PC (chiffré)", prefs.host)
            prefs.enabled && prefs.fp.isEmpty() -> Triple(coral, "Jumelage à refaire", "Scannez à nouveau le QR code du PC pour activer le chiffrement")
            prefs.enabled -> Triple(amber, "Connexion au PC en cours…", "Vérifiez que le PC est allumé, sur le même Wi-Fi")
            else -> Triple(coral, "Non connecté", "Scannez le QR code pour commencer")
        }
        statusDot.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
        statusTitle.text = text
        statusSub.text = sub
        permList.forEach { setChip(it.chip, it.perms.all { p -> granted(p) }) }
        setChip(chipNotifs, NotifListener.instance != null)
        setChip(chipBattery, getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName))
    }

    private fun permRowFor(label: String, perms: List<String>): LinearLayout {
        val c = chip()
        permList.add(Perm(perms, c))
        return permRow(label, c) {
            val missing = perms.filter { !granted(it) }
            if (missing.isEmpty()) {
                Toast.makeText(this, "Déjà autorisé", Toast.LENGTH_SHORT).show()
            } else {
                requestPermissions(missing.toTypedArray(), 1)
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val denied = permissions.filterIndexed { i, _ -> grantResults.getOrNull(i) != PackageManager.PERMISSION_GRANTED }
        // Android n'affiche plus la fenêtre après deux refus : on ouvre alors les réglages de l'application.
        if (denied.isNotEmpty() && denied.none { shouldShowRequestPermissionRationale(it) }) {
            Toast.makeText(this, "Activez cette autorisation dans Autorisations, puis revenez ici", Toast.LENGTH_LONG).show()
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))
            )
        }
    }

    private fun scan() {
        GmsBarcodeScanning.getClient(this).startScan()
            .addOnSuccessListener { b ->
                val raw = b.rawValue ?: return@addOnSuccessListener
                val m = Regex("^phonebridge://([^/]+)/([A-Za-z0-9-]+)$").find(raw)
                if (m == null) {
                    Toast.makeText(this, "Ce QR code n'est pas celui de PhoneBridge", Toast.LENGTH_LONG).show()
                } else {
                    host.setText(m.groupValues[1])
                    code.setText(m.groupValues[2])
                    connect()
                }
            }
            .addOnFailureListener { Toast.makeText(this, "Scan impossible : " + it.message, Toast.LENGTH_LONG).show() }
    }

    private fun connect() {
        val h = host.text.toString().trim()
        val parts = code.text.toString().trim().split("-")
        if (h.isEmpty() || parts.size != 2 || parts[0].isEmpty() || parts[1].length < 16) {
            Toast.makeText(this, "Scannez le QR code, ou saisissez l'adresse et le code complet", Toast.LENGTH_LONG).show()
            return
        }
        prefs.host = h
        prefs.token = parts[0].uppercase()
        prefs.fp = parts[1].lowercase()
        prefs.enabled = true
        stopService(Intent(this, BridgeService::class.java))
        startBridge()
    }

    private fun startBridge() {
        startForegroundService(Intent(this, BridgeService::class.java))
    }

    private fun disconnect() {
        prefs.enabled = false
        stopService(Intent(this, BridgeService::class.java))
    }
}
