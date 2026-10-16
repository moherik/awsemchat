const { withAppBuildGradle } = require('expo/config-plugins');

const beginMarker = '// awsemchat-release-signing:start';
const endMarker = '// awsemchat-release-signing:end';
const signingVariables = [
  'AWSEMCHAT_ANDROID_RELEASE_STORE_FILE',
  'AWSEMCHAT_ANDROID_RELEASE_STORE_PASSWORD',
  'AWSEMCHAT_ANDROID_RELEASE_KEY_ALIAS',
  'AWSEMCHAT_ANDROID_RELEASE_KEY_PASSWORD',
];

function applyReleaseSigning(contents) {
  const hasBegin = contents.includes(beginMarker);
  const hasEnd = contents.includes(endMarker);
  if (hasBegin || hasEnd) {
    if (hasBegin && hasEnd && contents.includes('signingConfig signingConfigs.release')) return contents;
    throw new Error('Android release signing config plugin found an incomplete generated block.');
  }
  if (signingVariables.every(name => contents.includes(name)) && contents.includes('signingConfig signingConfigs.release')) {
    return contents;
  }

  const signingStart = contents.indexOf('    signingConfigs {');
  const signingEnd = contents.indexOf('\n    }\n    buildTypes {', signingStart);
  const buildTypesStart = signingEnd < 0 ? -1 : contents.indexOf('    buildTypes {', signingEnd);
  const releaseStart = buildTypesStart < 0 ? -1 : contents.indexOf('        release {', buildTypesStart);
  const releaseEnd = releaseStart < 0 ? -1 : contents.indexOf('\n        }', releaseStart);
  if (signingStart < 0 || signingEnd < 0 || releaseStart < 0 || releaseEnd < 0) {
    throw new Error('Android release signing config plugin could not find the expected Expo Gradle blocks.');
  }

  let releaseBlock = contents.slice(releaseStart, releaseEnd);
  if (releaseBlock.includes('signingConfig signingConfigs.debug')) {
    releaseBlock = releaseBlock.replace('signingConfig signingConfigs.debug', 'signingConfig signingConfigs.release');
  } else if (!releaseBlock.includes('signingConfig signingConfigs.release')) {
    throw new Error('Android release signing config plugin found an unsupported release signing setup.');
  }

  const configured = `
        ${beginMarker}
        def releaseSigningValues = [
            'AWSEMCHAT_ANDROID_RELEASE_STORE_FILE': System.getenv('AWSEMCHAT_ANDROID_RELEASE_STORE_FILE')?.trim(),
            'AWSEMCHAT_ANDROID_RELEASE_STORE_PASSWORD': System.getenv('AWSEMCHAT_ANDROID_RELEASE_STORE_PASSWORD'),
            'AWSEMCHAT_ANDROID_RELEASE_KEY_ALIAS': System.getenv('AWSEMCHAT_ANDROID_RELEASE_KEY_ALIAS')?.trim(),
            'AWSEMCHAT_ANDROID_RELEASE_KEY_PASSWORD': System.getenv('AWSEMCHAT_ANDROID_RELEASE_KEY_PASSWORD'),
        ]
        def missingReleaseSigningValues = releaseSigningValues.findAll { name, value -> !value }.keySet()
        def releaseTaskRequested = gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }
        if (releaseTaskRequested && !missingReleaseSigningValues.isEmpty()) {
            throw new GradleException('Missing Android release signing configuration. Set: AWSEMCHAT_ANDROID_RELEASE_STORE_FILE, AWSEMCHAT_ANDROID_RELEASE_STORE_PASSWORD, AWSEMCHAT_ANDROID_RELEASE_KEY_ALIAS, AWSEMCHAT_ANDROID_RELEASE_KEY_PASSWORD')
        }
        release {
            if (missingReleaseSigningValues.isEmpty()) {
                def signingStore = new File(releaseSigningValues['AWSEMCHAT_ANDROID_RELEASE_STORE_FILE'])
                if (!signingStore.isAbsolute()) throw new GradleException('AWSEMCHAT_ANDROID_RELEASE_STORE_FILE must be an absolute path.')
                storeFile signingStore
                storePassword releaseSigningValues['AWSEMCHAT_ANDROID_RELEASE_STORE_PASSWORD']
                keyAlias releaseSigningValues['AWSEMCHAT_ANDROID_RELEASE_KEY_ALIAS']
                keyPassword releaseSigningValues['AWSEMCHAT_ANDROID_RELEASE_KEY_PASSWORD']
            }
        }
        ${endMarker}`;

  const withReleaseConfig = contents.slice(0, signingEnd) + configured + contents.slice(signingEnd);
  const updatedBuildTypesStart = withReleaseConfig.indexOf('    buildTypes {', signingEnd + configured.length);
  const updatedReleaseStart = withReleaseConfig.indexOf('        release {', updatedBuildTypesStart);
  const updatedReleaseEnd = withReleaseConfig.indexOf('\n        }', updatedReleaseStart);
  if (updatedReleaseStart < 0 || updatedReleaseEnd < 0) throw new Error('Android release signing config plugin lost the release build type.');
  return withReleaseConfig.slice(0, updatedReleaseStart) + releaseBlock + withReleaseConfig.slice(updatedReleaseEnd);
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('AwsemChat release signing expects the Groovy Android Gradle template.');
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
