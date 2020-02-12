import axios from 'axios';
import chalk from 'chalk';

export function getInformation(server, appName, api) {
  return api.runSSHCommand(server, `docker inspect ${appName} --format "{{json .}}"`)
    // eslint-disable-next-line complexity
    .then(({ host, output }) => {
      let info;
      const stoppedResult = {
        statusColor: 'red',
        status: 'Stopped',
        host: server.host
      };

      try {
        // Sometimes there are warnings shown before the JSON output
        const jsonOutput = output.slice(output.indexOf('{'));
        info = JSON.parse(jsonOutput.trim());
      } catch (e) {
        return stoppedResult;
      }

      if (!info.State) {
        return stoppedResult;
      }

      let statusColor = 'green';
      if (info.State.Restarting) {
        statusColor = 'yellow';
      } else if (!info.State.Running) {
        statusColor = 'red';
      }

      const publishedPorts = [];
      const exposedPorts = [];
      if (info.NetworkSettings) {
        Object.keys(info.NetworkSettings.Ports || {}).forEach(key => {
          if (info.NetworkSettings.Ports[key]) {
            publishedPorts.push(`${key} => ${info.NetworkSettings.Ports[key][0].HostPort}`);
          } else {
            exposedPorts.push(key);
          }
        });
      }

      const env = {};
      if (info.Config && info.Config.Env) {
        info.Config.Env.forEach(envVariable => {
          const name = envVariable.split('=')[0];
          env[name] = envVariable;
        });
      }

      const restartCount = info.RestartCount;
      let restartColor = 'green';
      if (restartCount > 0) {
        restartColor = 'yellow';
      } else if (restartCount > 2) {
        restartColor = 'red';
      }

      return {
        host,
        created: info.Created,
        status: info.State.Status,
        statusColor,
        env: Object.values(env),
        restartCount,
        restartColor,
        publishedPorts,
        exposedPorts
      };
    });
}

async function checkUrlLocally(server, appConfig) {
  let result;

  try {
    result = await axios.head(`http://${server.host}:${appConfig.env.PORT}`, {
      timeout: 5000
    });
  } catch (e) {
    result = false;
  }

  return result;
}

export async function checkUrls(server, appConfig, api) {
  const [
    remote,
    inDocker,
    local
  ] = await Promise.all([
    api.runSSHCommand(server, `curl 127.0.0.1:${appConfig.env.PORT}`),
    api.runSSHCommand(server, `docker exec ${appConfig.name} curl http://localhost:${appConfig.docker.imagePort}`),
    checkUrlLocally(server, appConfig)
  ]);
  const inDockerResult = inDocker.code === 0;
  const remoteResult = remote.code === 0;
  const localResult = local !== false;

  return {
    inDocker: inDockerResult,
    inDockerColor: inDockerResult ? 'green' : 'red',
    remote: remoteResult,
    remoteColor: remoteResult ? 'green' : 'red',
    local: localResult,
    localColor: localResult ? 'green' : 'red'
  };
}

export function createPortInfoLines(
  exposedPorts = [], publishedPorts = [], statusDisplay
) {
  if (exposedPorts.length > 0) {
    const exposedSection = statusDisplay.addLine('Exposed Ports:');
    exposedPorts.forEach(port => {
      exposedSection.addLine(`- ${port}`);
    });
  }

  if (publishedPorts.length > 0) {
    const publisehdSection = statusDisplay.addLine('Published Ports:');
    publishedPorts.forEach(port => {
      publisehdSection.addLine(`- ${port}`);
    });
  }
}

export function withColor(color, text) {
  return chalk[color](text);
}

export function displayAvailability(result, urlResult, statusDisplay) {
  if (result.publishedPorts && result.publishedPorts.length > 0) {
    const section = statusDisplay.addLine(`App running at http://${result.host}:${result.publishedPorts[0].split('=>')[1].trim()}`);
    section.addLine(`- Available in app's docker container: ${urlResult.inDocker}`, urlResult.inDockerColor);
    section.addLine(`- Available on server: ${urlResult.remote}`, urlResult.remoteColor);
    section.addLine(`- Available on local computer: ${urlResult.local}`, urlResult.localColor);
  } else {
    const section = statusDisplay.addLine('App available through reverse proxy');
    section.addLine(`- Available in app's docker container: ${urlResult.inDocker}`, urlResult.inDockerColor);
  }
}
