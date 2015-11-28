import {isObject} from 'lodash';

export function json(strings, ...values) {
  let result = '';
  strings.forEach((fragment, i) => {
    let value = values[i];
    result += fragment + (isObject(value) ? stringify(value) : value || '')
  });
  return result;
}

export function stringify(obj) {
  return JSON.stringify(obj, null, 4);
}
