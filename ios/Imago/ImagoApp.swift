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
        .animation(.easeOut(duration: 0.6), value: loadState.loading)
    }
}

// A single drifting mayfly's parameters (ported from the old Efemera
// IntroAnimation: left-to-right drift with a sine wobble, random size/opacity).
private struct Fly: Identifiable {
    let id = UUID()
    let baseX: Double       // 0…1.2 starting phase across the width
    let y: Double           // 0…1 vertical position
    let size: CGFloat       // points
    let speed: Double       // fraction of width per second
    let phase: Double       // wobble phase offset
    let wobbleAmp: Double   // fraction of height
    let wobbleSpeed: Double
    let opacity: Double
}

struct MayflyLoadingView: View {
    private let start = Date()
    @State private var flies: [Fly] = (0..<34).map { _ in
        Fly(baseX: .random(in: 0...1.2),
            y: .random(in: 0.05...0.9),
            size: .random(in: 30...66),
            speed: .random(in: 0.035...0.085),
            phase: .random(in: 0...(2 * .pi)),
            wobbleAmp: .random(in: 0.008...0.035),
            wobbleSpeed: .random(in: 0.6...1.6),
            opacity: .random(in: 0.4...0.95))
    }

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation) { timeline in
                let t = timeline.date.timeIntervalSince(start)
                ZStack {
                    Color.black
                    ForEach(flies) { f in
                        // Wrap x across the width (with a margin so flies enter
                        // and exit off-screen); wobble y with a sine.
                        let xFrac = (f.baseX + f.speed * t).truncatingRemainder(dividingBy: 1.2) - 0.1
                        let yFrac = f.y + sin(t * f.wobbleSpeed + f.phase) * f.wobbleAmp
                        Image("mayfly")
                            .resizable()
                            .scaledToFit()
                            .frame(width: f.size, height: f.size)
                            .rotationEffect(.degrees(90)) // point in the direction of travel
                            .opacity(f.opacity)
                            .position(x: CGFloat(xFrac) * geo.size.width,
                                      y: CGFloat(yFrac) * geo.size.height)
                    }
                }
            }
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

        // Overscroll (top AND bottom rubber-band) follows the page's own body
        // color — set here as white for the first paint, then corrected per-page
        // in didFinish. (A previous version tried to split top-white/bottom-page
        // via a raw UIView pinned above the scroll content; that native subview
        // could paint OVER the page's own fixed-position header on scroll,
        // since it lives outside the WKWebView's content layer entirely. One
        // uniform, page-driven color has no such layering risk.)
        // Seed with the dashboard's color (the landing page) rather than white,
        // so there's no white flash/band while the first page loads, before
        // didCommit/didFinish read the page's real background.
        let dashboardBG = UIColor(cssRGB: "rgb(245, 248, 250)") ?? .white // #f5f8fa
        webView.backgroundColor = dashboardBG
        webView.scrollView.backgroundColor = dashboardBG
        webView.underPageBackgroundColor = dashboardBG

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        context.coordinator.webView = webView
        webView.load(URLRequest(url: HOME_URL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        let loadState: LoadState

        // The mayflies play for at least this long even if the page is ready
        // sooner — so it always reads as an intentional entrance, never a
        // half-second flash. Dismissal waits for BOTH this and the page load.
        private static let minSplashSeconds = 3.0
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
            if loadState.loading { loadState.loading = false }
        }
        private func markPageLoaded() {
            pageLoaded = true
            maybeDismiss()
        }

        @objc func reload(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        // Match the web view + overscroll to the page's effective background,
        // the way Safari derives it: body if opaque, else html, else white.
        // Run on BOTH didCommit (first render — kills the white band before the
        // user sees it) and didFinish (final, if body bg loads late).
        private func syncPageBackground(_ webView: WKWebView) {
            let js = """
            (function(){
              function bg(el){ var c = getComputedStyle(el).backgroundColor;
                return (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') ? c : null; }
              return bg(document.body) || bg(document.documentElement) || 'rgb(255, 255, 255)';
            })()
            """
            webView.evaluateJavaScript(js) { value, _ in
                guard let rgb = value as? String, let color = UIColor(cssRGB: rgb) else { return }
                webView.underPageBackgroundColor = color
                webView.backgroundColor = color
                webView.scrollView.backgroundColor = color
            }
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            syncPageBackground(webView)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.refreshControl?.endRefreshing()
            syncPageBackground(webView)
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
