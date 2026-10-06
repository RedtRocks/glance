import { render } from 'preact'
import { App } from './ui/App'
import './styles/app.css'
import './styles/annotation-layer.css'
import './styles/web.css'
import { forwardErrors } from './platform/log'
import { isWeb, websiteCloseAll } from './platform'
import { blockPageZoom } from './ui/touchGestures'

forwardErrors()
// The browser version takes the website's look (styles/web.css).
if (isWeb) document.documentElement.dataset.platform = 'web'
blockPageZoom()
// A company website from the Ask AI sidebar can outlive a reload of this page; nothing
// here would know to close it.
void websiteCloseAll().catch(() => undefined)

render(<App />, document.getElementById('app')!)
