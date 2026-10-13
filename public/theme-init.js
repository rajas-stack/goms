(function () {
  var pref = 'system'
  try {
    var saved = localStorage.getItem('goms.theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') pref = saved
  } catch (e) {}
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#000000' : '#FAFAF7')
})()
