import React from 'react';
import Cookies from 'universal-cookie';
import axios from 'axios';
import './App.css';
import ConsoleOutput from './ConsoleOutput';

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      inputDir: "",
      containerUrl: "",
      outputDir: "",
      replicas: "",
      isLoggedIn: false,
      uid: "",
      fnStatus: "none",
      fnStatusPollId: 0,
      specs: {},
      errorMsg: "",
      logs: false,
      showLogs: false
    };
    this.getSpecs = this.getSpecs.bind(this);
    this.authenticateUser = this.authenticateUser.bind(this);
    this.handleInputDirChange = this.handleInputDirChange.bind(this);
    this.handleContainerUrlChange = this.handleContainerUrlChange.bind(this);
    this.handleOutputDirChange = this.handleOutputDirChange.bind(this);
    this.handleReplicasChange = this.handleReplicasChange.bind(this);
    this.handleMap = this.handleMap.bind(this);
    this.fnStatusPoll = this.fnStatusPoll.bind(this);
    this.toggleLogsPage = this.toggleLogsPage.bind(this);
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
      const cookies = new Cookies();
      var auth_header = 'Bearer ' + cookies.get('sm_token');
      const request = axios({
        method: 'GET',
        url: `${this.state.specs.cdriveApiUrl}user-details/`,
        headers: {'Authorization': auth_header}
      });
      request.then(
        response => {
          this.setState({isLoggedIn: true});
          return(null);
        }, err => {
          cookies.remove('sm_token');
          window.location.reload(false);
        }
      );
      return (null);
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
    this.setState({fnStatus: "executing"});
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
        this.setState({ 
          uid: response.data.uid,
          fnStatusPollId: setInterval(() => this.fnStatusPoll(), 500)
        });
      },
    );
  }
  fnStatusPoll() {
    const request = axios({
      method: 'GET',
      url: `${this.state.specs.cdriveUrl}app/${this.state.specs.username}/sm-mapper/api/status?uid=${this.state.uid}`
    });
    request.then(
      response => {
        if(response.data.fnStatus === "complete") {
          clearInterval(this.state.fnStatusPollId);
          this.setState({
            fnStatus: "complete"
          });
        } else if (response.data.fnStatus === "error") {
          clearInterval(this.state.fnStatusPollId);
          this.setState({
            fnStatus: "error",
            errorMsg: response.data.message,
            logs: (response.data.logs === "Y")
          });
        }
      },
    );
  }
  toggleLogsPage() {
    this.setState({
      showLogs: !this.state.showLogs
    });
  }
  render() {
    if (Object.keys(this.state.specs).length === 0) {
      this.getSpecs();
      return(null);
    } else if (!this.state.isLoggedIn) {
      this.authenticateUser();
      return(null);
    } else if(this.state.showLogs) {
      return (
        <ConsoleOutput specs={this.state.specs} uid={this.state.uid} replicas={this.state.replicas} toggle={this.toggleLogsPage} />
      );
    } else {
      let mapButton;
      if (this.state.fnStatus === "executing") {
        mapButton = (
          <button className="btn btn-primary map-form-item" disabled>
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            <span className="ml-2">Map</span>
          </button>
        );
      } else {
        mapButton = (
          <button className="btn btn-primary map-form-item" onClick={this.handleMap}>
            Map
          </button>
        );
      }
      let cdriveLink;
      if(this.state.fnStatus === "complete") {
        cdriveLink = (
          <div className="h5 mt-3 font-weight-normal map-form-item">
            Output saved! <a href={this.state.specs.cdriveUrl}> View {"in"} CDrive </a>
          </div>
        );
      }
      let logsLink;
      if(this.state.logs) {
        logsLink = (
          <button className="btn btn-info btn-sm ml-2" onClick={this.toggleLogsPage}>
            <span className="h5 font-weight-normal">View logs</span>
          </button>
        ); 
      }
      let errorMsg;
      if(this.state.fnStatus === "error") {
        errorMsg = (
          <div className="mt-3 map-form-item">
            <span className="h5 font-weight-normal err-msg">Error: {this.state.errorMsg}</span>
            {logsLink}
          </div>
        );
      }
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
            {mapButton}
            {cdriveLink}
            {errorMsg}
          </div>
        </div>
      );
    }
  }
}

export default App;
