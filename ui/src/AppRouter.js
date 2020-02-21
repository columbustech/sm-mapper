import React from 'react';
import { HashRouter as Router, Route, Switch} from 'react-router-dom';
import App from './App';

class AppRouter extends React.Component {
    render() {
        return(
            <Router>
                <Switch>
                    <Route path="/" component={App} />
                </Switch>
            </Router>
        );
    }
}

export default AppRouter;
