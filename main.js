document.addEventListener('DOMContentLoaded', () => {
  const lineList = document.getElementById('lineList');
  const stopsSection = document.getElementById('stopsContainer');

  if (!lineList || !stopsSection) return;

  // Event delegation: listen for clicks on any line pill, even dynamically added
  lineList.addEventListener('click', (e) => {
    const pill = e.target.closest('.line-pill, .metro-pill');
    if (!pill) return;

    if (window.innerWidth <= 900) {
      stopsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
