/**
 * Returns a shallow copy of the object containing only the given keys that
 * exist as its own properties.
 */
export function pick<T extends object>(object: T, keys: string[]): Partial<T> {
  return keys.reduce((obj, key) => {
    if (object && Object.prototype.hasOwnProperty.call(object, key)) {
      obj[key as keyof T] = object[key as keyof T];
    }
    return obj;
  }, {} as Partial<T>);
}

export default pick;
