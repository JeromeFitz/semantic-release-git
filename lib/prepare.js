/**
 * @ref
 * https://github.com/semantic-release/semantic-release/blob/master/docs/developer-guide/js-api.md
 */
// const { isPlainObject, isArray, castArray, template, uniq } = require("lodash");
const {isPlainObject, isArray, castArray, uniq} = require('lodash');
const micromatch = require('micromatch');
const dirGlob = require('dir-glob');
const pReduce = require('p-reduce');
const debug = require('debug')('semantic-release:git');
const resolveConfig = require('./resolve-config');
const {getModifiedFiles, add, commit, push} = require('./git');

/**
 *
 * @customization
 */
const getGitHttpsUrl = repositoryUrl => {
  return repositoryUrl.replace('ssh://git@', 'https://').replace('.git', '');
};

/**
 *
 * @customization
 */
const getCommitMessage = ({branch, env, message, nextRelease, repositoryUrl}) => {
  return (
    message
      // @note Fallback if not monorepo
      .replace(/{BRANCH_NAME}/g, branch.name)
      .replace(/{PACKAGE_NAME}/g, env.LERNA_PACKAGE_NAME || env.npm_package_name)
      .replace(/{RELEASE_NOTES}/g, nextRelease.notes)
      .replace(/{RELEASE_TAG}/g, nextRelease.gitTag)
      .replace(/{RELEASE_URL}/g, getGitHttpsUrl(repositoryUrl))
      .replace(/{VERSION}/g, nextRelease.version)
  );
};

/**
 * Prepare a release commit including configurable files.
 *
 * @param {Object} pluginConfig The plugin configuration.
 * @param {String|Array<String>} [pluginConfig.assets] Files to include in the release commit. Can be files path or globs.
 * @param {String} [pluginConfig.message] The message for the release commit.
 * @param {Object} context semantic-release context.
 * @param {Object} context.options `semantic-release` configuration.
 * @param {Object} context.lastRelease The last release.
 * @param {Object} context.nextRelease The next release.
 * @param {Object} logger Global logger.
 */
module.exports = async (pluginConfig, context) => {
  const {
    env,
    cwd,
    branch,
    options: {repositoryUrl},
    lastRelease,
    nextRelease,
    logger,
  } = context;
  const {message, assets} = resolveConfig(pluginConfig, logger);

  const modifiedFiles = await getModifiedFiles({env, cwd});

  const filesToCommit = uniq(
    await pReduce(
      assets.map(asset => (!isArray(asset) && isPlainObject(asset) ? asset.path : asset)),
      async (result, asset) => {
        const glob = castArray(asset);
        let nonegate;
        // Skip solo negated pattern (avoid to include every non js file with `!**/*.js`)
        if (glob.length <= 1 && glob[0].startsWith('!')) {
          nonegate = true;
          debug(
            'skipping the negated glob %o as its alone in its group and would retrieve a large amount of files ',
            glob[0]
          );
        }

        return [
          ...result,
          ...micromatch(modifiedFiles, await dirGlob(glob, {cwd}), {dot: true, nonegate, cwd, expand: true}),
        ];
      },
      []
    )
  );

  if (filesToCommit.length > 0) {
    logger.log('Found %d file(s) to commit', filesToCommit.length);
    await add(filesToCommit, {env, cwd});
    debug('commited files: %o', filesToCommit);
    /**
     *
     * @customization
     * previous => template(message)({branch: branch.name, lastRelease, nextRelease})
     */
    await commit(
      message
        ? getCommitMessage({
            branch,
            env,
            message,
            lastRelease,
            nextRelease,
            repositoryUrl,
          })
        : `chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}`,
      {env, cwd}
    );
    await push(repositoryUrl, branch.name, {env, cwd});
    logger.log('Prepared Git release: %s', nextRelease.gitTag);
  }
};
