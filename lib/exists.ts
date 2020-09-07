var fs = require("fs");

export default function exists(pathName: string) {
  try {
    fs.statSync(pathName);
    return true;
  } catch (e) {
    return false;
  }
}
