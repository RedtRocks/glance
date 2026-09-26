import { render } from 'preact'
import { App } from './ui/App'
import './styles/app.css'
import { forwardErrors } from './platform/log'

forwardErrors()

render(<App />, document.getElementById('app')!)
