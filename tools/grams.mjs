export const STOP = new Set('a an the of to in on at by for and or but if is are was be it its this that with as from into than then so we you your our i me my he she they them their his her not no do does did can will just up out all any each per via'.split(' '));
export const words = (s) => (s.toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
export const bigrams = (ws) => {
  const out = [];
  for (let i = 0; i < ws.length - 1; i++) {
    if (STOP.has(ws[i]) && STOP.has(ws[i + 1])) continue; // function-word pairs carry no copy
    out.push(ws[i] + ' ' + ws[i + 1]);
  }
  return out;
};
