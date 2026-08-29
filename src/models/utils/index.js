const { basename, extname, join, sep } = require('path');
const { globSync } = require('glob');

const toGlobPattern = (relativePattern) => join(__dirname, relativePattern).split(sep).join('/');

// Matches both .js and .cjs: Vercel's serverless build recompiles source
// files to .cjs, so a plain *.js glob finds nothing at runtime there.
const appModelsFiles = globSync(toGlobPattern('../appModels/**/*.{js,cjs}'));

const pattern = toGlobPattern('../**/*.{js,cjs}');

const modelsFiles = globSync(pattern).map((filePath) => {
  const fileNameWithExtension = basename(filePath);
  const fileNameWithoutExtension = fileNameWithExtension.replace(
    extname(fileNameWithExtension),
    ''
  );
  return fileNameWithoutExtension;
});

const constrollersList = [];
const appModelsList = [];
const entityList = [];
const routesList = [];

for (const filePath of appModelsFiles) {
  const fileNameWithExtension = basename(filePath);
  const fileNameWithoutExtension = fileNameWithExtension.replace(
    extname(fileNameWithExtension),
    ''
  );
  const firstChar = fileNameWithoutExtension.charAt(0);
  const modelName = fileNameWithoutExtension.replace(firstChar, firstChar.toUpperCase());
  const fileNameLowerCaseFirstChar = fileNameWithoutExtension.replace(
    firstChar,
    firstChar.toLowerCase()
  );
  const entity = fileNameWithoutExtension.toLowerCase();

  controllerName = fileNameLowerCaseFirstChar + 'Controller';
  constrollersList.push(controllerName);
  appModelsList.push(modelName);
  entityList.push(entity);

  const route = {
    entity: entity,
    modelName: modelName,
    controllerName: controllerName,
  };
  routesList.push(route);
}

module.exports = { constrollersList, appModelsList, modelsFiles, entityList, routesList };
