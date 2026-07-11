import SwiftUI
import WebKit

// Imago — a thin native shell around gangrey.org/admin/imago.
//
// Design notes:
// - WKWebsiteDataStore.default() persists cookies to disk, so the Imago admin
//   session survives app relaunches: log in once, stay logged in.
// - Links to other hosts (Stripe, GitHub, story shares…) open in Safari; the
//   app view stays on gangrey.org.
// - target="_blank" windows (e.g. "Create story draft" opens the editor in a
//   new tab) load in the same web view instead of being silently dropped —
//   WKWebView has no tabs.
// - Pull-to-refresh reloads, matching how you'd nudge a stuck panel on mobile.

private let HOME_URL = URL(string: "https://gangrey.org/admin/imago")!
private let APP_HOST = "gangrey.org"

extension UIColor {
    // Parses "rgb(r, g, b)" / "rgba(r, g, b, a)" as returned by
    // getComputedStyle; returns nil for anything else (e.g. "transparent").
    convenience init?(cssRGB: String) {
        let nums = cssRGB
            .replacingOccurrences(of: "rgba(", with: "")
            .replacingOccurrences(of: "rgb(", with: "")
            .replacingOccurrences(of: ")", with: "")
            .split(separator: ",")
            .map { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard nums.count >= 3, let r = nums[0], let g = nums[1], let b = nums[2] else { return nil }
        let a = nums.count >= 4 ? (nums[3] ?? 1) : 1
        self.init(red: r / 255, green: g / 255, blue: b / 255, alpha: a)
    }
}

@main
struct ImagoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

// Drives the mayfly splash: true until the first page finishes loading.
final class LoadState: ObservableObject {
    @Published var loading = true
}

struct ContentView: View {
    @StateObject private var loadState = LoadState()

    var body: some View {
        ZStack {
            // Full-bleed, page-owned layout: the web view covers the whole screen
            // and the PAGE handles the notch — the site declares viewport-fit=cover
            // and stretches its admin headers by env(safe-area-inset-top), so the
            // header background runs to the physical top and nothing can scroll
            // out above it. No native strips or overlays.
            ImagoWebView(loadState: loadState)
                .ignoresSafeArea()
                .background(Color.white)

            // Efemera's mayfly entrance, reborn as the loading screen: white
            // mayflies drifting across black while the web view fetches.
            if loadState.loading {
                MayflyLoadingView()
                    .transition(.opacity)
            }
        }
    }
}

// Redesigned splash (Imago Mobile prototype): one crimson mayfly flies in from
// the lower-left along a curved, decelerating path, settles level and
// motionless centered above the wordmark, and "imago" fades up beneath it.
// Drawn per-frame from an explicit timeline (TimelineView + manual keyframe
// interpolation) — no implicit SwiftUI animations, which cross-contaminated
// in an earlier version of this screen.
struct MayflyLoadingView: View {
    private let start = Date()

    // CSS `mayflyIn` keyframes: progress → (x, y, rotation°, scale).
    private static let path: [(p: Double, x: Double, y: Double, r: Double, s: Double)] = [
        (0.00, -150, 230, 38, 0.55),
        (0.62,   14, -14, -8, 1.02),
        (0.82,   -4,   4,  5, 1.00),
        (1.00,    0,   0,  0, 1.00),
    ]
    private static let flyDuration = 2.3
    private static let wordmarkDuration = 1.8 // opacity 0 until 42%, then fade up

    // Ease-out ≈ cubic-bezier(.22,.68,.24,1): fast start, long deceleration.
    private func easeOut(_ t: Double) -> Double { 1 - pow(1 - t, 3) }

    private func flyState(at elapsed: Double) -> (x: CGFloat, y: CGFloat, r: Angle, s: CGFloat, o: Double) {
        let t = min(max(elapsed / Self.flyDuration, 0), 1)
        let e = easeOut(t)
        let keys = Self.path
        var a = keys[0], b = keys[keys.count - 1]
        for i in 0..<(keys.count - 1) where e >= keys[i].p && e <= keys[i + 1].p {
            a = keys[i]; b = keys[i + 1]
        }
        let f = b.p > a.p ? (e - a.p) / (b.p - a.p) : 1
        let lerp = { (u: Double, v: Double) in u + (v - u) * f }
        let opacity = min(e / 0.28, 1) // fades in over the first stretch of the flight
        return (CGFloat(lerp(a.x, b.x)), CGFloat(lerp(a.y, b.y)),
                .degrees(lerp(a.r, b.r)), CGFloat(lerp(a.s, b.s)), opacity)
    }

    var body: some View {
        TimelineView(.animation) { timeline in
            let elapsed = timeline.date.timeIntervalSince(start)
            let fly = flyState(at: elapsed)
            // Wordmark: hold invisible for the first 42%, then fade + rise.
            let wt = min(max(elapsed / Self.wordmarkDuration, 0), 1)
            let wf = wt <= 0.42 ? 0.0 : easeOut((wt - 0.42) / 0.58)

            VStack(spacing: 18) {
                Image("crimson-mayfly")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 76, height: 76)
                    .scaleEffect(fly.s)
                    .rotationEffect(fly.r)
                    .offset(x: fly.x, y: fly.y)
                    .opacity(fly.o)
                HStack(spacing: 0) {
                    Text("i").foregroundColor(Color(red: 0x49 / 255, green: 0, blue: 0))
                    Text("mago").foregroundColor(.black)
                }
                .font(.system(size: 40, weight: .black))
                .kerning(-0.8)
                .opacity(wf)
                .offset(y: 8 * (1 - wf))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(red: 245 / 255, green: 248 / 255, blue: 250 / 255))
        }
        .ignoresSafeArea()
    }
}

// Hosts allowed to load inside the app's web view. gangrey.org is the app;
// the Google domains are required for Imago's Google sign-in — if those open
// in Safari instead, the session cookie lands in Safari and the app never
// logs in.
private func isInAppHost(_ host: String) -> Bool {
    if host == APP_HOST || host.hasSuffix("." + APP_HOST) { return true }
    // youtube.com: Google's sign-in bounces through accounts.youtube.com to
    // sync its session across properties — kick that hop to Safari and the
    // whole login strands there.
    for allowed in ["google.com", "gstatic.com", "googleapis.com", "googleusercontent.com", "youtube.com"] {
        if host == allowed || host.hasSuffix("." + allowed) { return true }
    }
    return false
}

struct ImagoWebView: UIViewRepresentable {
    let loadState: LoadState

    func makeCoordinator() -> Coordinator { Coordinator(loadState: loadState) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistent cookies → stay logged in
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        // .never: don't inject scroll insets for the notch — the page lays
        // itself out with env(safe-area-inset-top) instead (viewport-fit=cover),
        // so its headers stretch to the physical top of the screen.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // Present as mobile Safari. Google's OAuth page rejects user agents it
        // classifies as embedded webviews ("disallowed_useragent"); the stock
        // WKWebView UA lacks the Version/Safari tokens and can trip that.
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

        // Split overscroll: TOP white (the header), BOTTOM blue-gray (the
        // canvas). WKWebView has ONE native overscroll color at a time
        // (underPageBackgroundColor — WebKit paints it inside the content
        // layer, so filler subviews behind the page can never show through).
        // The switch is driven by KVO on contentOffset — NOT the scroll
        // view's delegate (WKWebView owns that and may replace it, which is
        // why delegate-based switching never fired) and NOT DOM color reads
        // (React's first frame is a placeholder, so reads race hydration).
        // The admin's colors are known constants, keyed off the URL in
        // applyColors(for:).
        webView.underPageBackgroundColor = .white // lands at the top first
        context.coordinator.offsetObservation = webView.scrollView.observe(\.contentOffset, options: [.new]) { [weak coordinator = context.coordinator] scrollView, _ in
            coordinator?.applyOverscrollColor(scrollView)
        }

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        context.coordinator.webView = webView
        context.coordinator.applyColors(for: HOME_URL)
        webView.load(URLRequest(url: HOME_URL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        let loadState: LoadState
        var offsetObservation: NSKeyValueObservation?

        // Per-page overscroll colors — hardcoded constants keyed off the URL,
        // no DOM reads. Admin headers are always white; the canvas is #f5f8fa
        // on the dashboard/newsletter and white in the story editor.
        private static let canvasGray = UIColor(cssRGB: "rgb(245, 248, 250)") ?? .white // #f5f8fa
        var topColor: UIColor = .white
        var bottomColor: UIColor = Coordinator.canvasGray

        func applyColors(for url: URL?) {
            topColor = .white
            let path = url?.path ?? ""
            // Story editor pages are white top to bottom; everything else in
            // the admin sits on the blue-gray canvas.
            bottomColor = path.contains("/admin/imago/posts/") ? .white : Coordinator.canvasGray
            if let webView {
                webView.backgroundColor = bottomColor
                webView.scrollView.backgroundColor = bottomColor
                applyOverscrollColor(webView.scrollView)
            }
        }

        // Swap the single native overscroll color by position: the top half of
        // the page shows the header color, the bottom half the canvas color.
        // Called from the KVO observation on contentOffset.
        func applyOverscrollColor(_ scrollView: UIScrollView) {
            guard let webView else { return }
            let maxOffset = max(scrollView.contentSize.height - scrollView.bounds.height, 1)
            let wantTop = scrollView.contentOffset.y < maxOffset / 2
            let color = wantTop ? topColor : bottomColor
            if webView.underPageBackgroundColor != color {
                webView.underPageBackgroundColor = color
            }
        }

        deinit { offsetObservation?.invalidate() }

        // The mayflies play for at least this long even if the page is ready
        // sooner — so it always reads as an intentional entrance, never a
        // half-second flash. Dismissal waits for BOTH this and the page load.
        private static let minSplashSeconds = 5.0
        private var minTimeElapsed = false
        private var pageLoaded = false

        init(loadState: LoadState) {
            self.loadState = loadState
            super.init()
            DispatchQueue.main.asyncAfter(deadline: .now() + Coordinator.minSplashSeconds) { [weak self] in
                self?.minTimeElapsed = true
                self?.maybeDismiss()
            }
            // Safety net: never let the splash stick if a load hangs or the
            // delegate callbacks don't fire.
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                self?.forceDismiss()
            }
        }

        // Fade the mayflies out once the animation has had its full run AND the
        // page is ready. Idempotent; later navigations just no-op.
        private func maybeDismiss() {
            if minTimeElapsed && pageLoaded { forceDismiss() }
        }
        private func forceDismiss() {
            // Explicit withAnimation: the flag flips from a navigation callback
            // (outside any SwiftUI transaction), so without this the splash
            // snaps away instead of fading into the dashboard.
            guard loadState.loading else { return }
            withAnimation(.easeInOut(duration: 1.0)) {
                loadState.loading = false
            }
        }
        private func markPageLoaded() {
            pageLoaded = true
            maybeDismiss()
        }

        @objc func reload(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            applyColors(for: webView.url)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
            applyColors(for: webView.url)
            // Give the first paint a beat before marking ready, so the dashboard
            // doesn't flash in half-rendered under the fade.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                self?.markPageLoaded()
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            webView.scrollView.refreshControl?.endRefreshing()
            forceDismiss() // don't strand the user behind the splash on a failed load
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            forceDismiss()
        }

        // WKWebView drops JavaScript alert()/confirm()/prompt() unless the
        // host app presents them natively — without these, every "Delete?"
        // confirm in Imago silently answers "no" and the button looks dead.
        private func topViewController() -> UIViewController? {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
            while let presented = top?.presentedViewController { top = presented }
            return top
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let vc = topViewController() else { completionHandler(); return }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            vc.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let vc = topViewController() else { completionHandler(false); return }
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            vc.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                     defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (String?) -> Void) {
            guard let vc = topViewController() else { completionHandler(nil); return }
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in completionHandler(alert?.textFields?.first?.text) })
            vc.present(alert, animated: true)
        }

        // Keep gangrey.org and the Google sign-in flow in-app; hand every
        // other host to Safari.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url,
                  let scheme = url.scheme, scheme.hasPrefix("http") else {
                decisionHandler(.allow)
                return
            }
            if isInAppHost(url.host ?? "") {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            }
        }

        // target="_blank" → load in the same view (no tabs in a WKWebView).
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url {
                if isInAppHost(url.host ?? "") {
                    webView.load(navigationAction.request)
                } else {
                    UIApplication.shared.open(url)
                }
            }
            return nil
        }
    }
}
