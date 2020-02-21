import React from 'react';
import Cookies from 'universal-cookie';
import axios from 'axios';
import './App.css';

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      inputDir: "",
      containerUrl: "",
      outputDir: "",
      replicas: "",
      isLoggedIn: false,
      specs: {},

    };
    this.getSpecs = this.getSpecs.bind(this);
    this.authenticateUser = this.authenticateUser.bind(this);
    this.handleInputDirChange = this.handleInputDirChange.bind(this);
    this.handleContainerUrlChange = this.handleContainerUrlChange.bind(this);
    this.handleOutputDirChange = this.handleOutputDirChange.bind(this);
    this.handleReplicasChange = this.handleReplicasChange.bind(this);
    this.handleMap = this.handleMap.bind(this);
  }
  getSpecs() {
    const request = axios({
      method: 'GET',
      url: `${window.location.protocol}//${window.location.hostname}${window.location.pathname}api/specs`
    });
    request.then(
      response => {
        this.setState({specs: response.data});
      },
    );
  }
  authenticateUser() {
    const cookies = new Cookies();
    var columbus_token = cookies.get('sm_token');
    if (columbus_token !== undefined) {
      this.setState({isLoggedIn: true});
      return(null);
    }
    var url_string = window.location.href;
    var url = new URL(url_string);
    var code = url.searchParams.get("code");
    var redirect_uri = this.state.specs.cdriveUrl + "app/" + this.state.specs.username + "/sm-mapper/";
    if (code == null) {
      window.location.href = this.state.specs.authUrl + "o/authorize/?response_type=code&client_id=" + this.state.specs.clientId + "&redirect_uri=" + redirect_uri + "&state=1234xyz";
    } else {
      const request = axios({
        method: 'POST',
        url: redirect_uri + "api/access-token",
        data: {
          code: code,
          redirect_uri: redirect_uri
        }
      });
      request.then(
        response => {
          cookies.set('sm_token', response.data.access_token);
          this.setState({isLoggedIn: true});
        },
        err => {
        }
      );
    }
  }
  handleInputDirChange(e) {
    this.setState({inputDir: e.target.value});
  }
  handleContainerUrlChange(e) {
    this.setState({containerUrl: e.target.value});
  }
  handleOutputDirChange(e) {
    this.setState({outputDir: e.target.value});
  }
  handleReplicasChange(e) {
    this.setState({replicas: e.target.value});
  }
  handleMap() {
    const cookies = new Cookies();
    const request = axios({
      method: 'POST',
      url: `${this.state.specs.cdriveUrl}app/${this.state.specs.username}/sm-mapper/api/map`,
      data: {
        inputDir: this.state.inputDir,
        containerUrl: this.state.containerUrl,
        outputDir: this.state.outputDir,
        replicas: this.state.replicas,
        accessToken: cookies.get('sm_token')
      }
    });
    request.then(
      response => {
        console.log("success");
      },
    );
  }
  render() {
    if (Object.keys(this.state.specs).length === 0) {
      this.getSpecs();
      return(null);
    } else if (!this.state.isLoggedIn) {
      this.authenticateUser();
      return(null);
    } else {
      return(
        <div className="app-container">
          <div className="map-form-container">
            <input type="text" placeholder="CDrive input folder path" className="map-form-item"
              value={this.state.inputDir} onChange={this.handleInputDirChange} />
            <input type="text" placeholder="Container URL" className="map-form-item"
              value={this.state.containerUrl} onChange={this.handleContainerUrlChange} />
            <input type="text" placeholder="CDrive output folder path" className="map-form-item"
              value={this.state.outputDir} onChange={this.handleOutputDirChange} />
            <input type="text" placeholder="No of container replicas" className="map-form-item"
              value={this.state.replicas} onChange={this.handleReplicasChange} />
            <button className="btn btn-primary map-form-item" onClick={this.handleMap}>Map</button>
          </div>
        </div>
      );
    }
  }
}

export default App;
