# Imago for iPhone

A thin native shell around gangrey.org/admin/imago — full-screen web view,
persistent login, pull-to-refresh, the G on your home screen. External links
(Stripe, shared stories, anything off gangrey.org) open in Safari.

## Sideload it (one-time setup ~5 minutes)

1. **Get this folder onto your Mac.** Clone the repo (or download it) and open
   `ios/Imago.xcodeproj` in Xcode.

2. **Sign it with your Apple ID.** Click the blue **Imago** project icon in the
   left sidebar → select the **Imago** target → **Signing & Capabilities** tab:
   - Check **Automatically manage signing**.
   - **Team**: pick your Apple ID. If it's not listed, Xcode → **Settings →
     Accounts → +** and sign in first — a free account works.
   - If Xcode complains the bundle identifier is taken, change
     `org.gangrey.imago` to anything unique (e.g. `com.yourname.imago`).

3. **Plug in your iPhone** with a cable. Unlock it and tap **Trust** when asked.

4. **Pick your phone as the destination** (the device menu in the toolbar, next
   to the scheme named *Imago*) and press **▶ Run** (⌘R).

5. **First-launch hurdles on the phone** (one time only):
   - If iOS says the developer isn't trusted: **Settings → General → VPN &
     Device Management** → your Apple ID → **Trust**.
   - If it asks for **Developer Mode**: **Settings → Privacy & Security →
     Developer Mode** → on → restart the phone.

6. Launch **Imago** from your home screen, log in once, and you'll stay
   logged in.

## Things to know

- **Free Apple ID: the app expires after 7 days.** Plug in and press Run again
  to re-sign it (your login survives). A paid Apple Developer account ($99/yr)
  extends that to a year — or use TestFlight and skip the cable entirely.
- You can unplug after installing; the cable is only needed to (re)install.
- Photo uploads use the iOS photo picker; the camera also works (permission
  string is already configured).
