import { render } from 'preact'
import { App } from './ui/App'
import './styles/app.css'
import './styles/annotation-layer.css'
import './styles/web.css'
import { forwardErrors } from './platform/log'
import { isWeb } from './platform'

forwardErrors()
// The browser version takes the website's look (styles/web.css).
if (isWeb) document.documentElement.dataset.platform = 'web'

render(<App />, document.getElementById('app')!)
