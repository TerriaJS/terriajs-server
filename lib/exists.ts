import { statSync } from "fs";

export default function exists(pathName: string) {
  try {
    statSync(pathName);
    return true;
  } catch (e) {
    return false;
  }
}
