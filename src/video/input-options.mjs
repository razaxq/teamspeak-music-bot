// Applied separately to each remote input. Resume interrupted range requests;
// do not reconnect at normal EOF, which would replay completed content.
export const remoteInputOptions = () => [
  '-rw_timeout','15000000','-reconnect','1','-reconnect_streamed','1',
  '-reconnect_on_network_error','1','-reconnect_on_http_error','429,5xx',
  '-reconnect_delay_max','2',
];
export const remoteInput = url => ['-re',...remoteInputOptions(),'-headers',
  'Referer: https://www.bilibili.com\r\nUser-Agent: Mozilla/5.0\r\n','-i',url];
