// The files a release contains, shared by build and package. Fixed files are named here; the
// area folders may hold any number of .js and .css modules, so adding one needs no edit here.
// Anything else in src/ (notes, fixtures, stray files) stops the build and the package.
export const FIXED_FILES = [
  'manifest.json', 'background.js', 'content/capture.js',
  'core/model.js', 'core/export.js', 'core/xlsx.js',
  'ui/workbench.html', 'ui/workbench.js', 'ui/workbench.css',
];
export const MODULE_FOLDERS = ['background', 'ui/workbench'];
const MODULE_NAME = /^[a-z0-9-]+\.(js|css)$/;

// Returns the sorted release file list for these source files, or throws naming stray files.
export function releaseFiles(sourceFiles, manifest) {
  const modules = sourceFiles.filter((path) => {
    const slash = path.lastIndexOf('/');
    return MODULE_FOLDERS.includes(path.slice(0, slash)) && MODULE_NAME.test(path.slice(slash + 1));
  });
  const expected = [...new Set([...FIXED_FILES, ...modules, ...Object.values(manifest.icons)])].sort();
  const stray = sourceFiles.filter((path) => !expected.includes(path));
  if (stray.length) throw new Error(`Unexpected files in the extension source: ${stray.join(', ')}`);
  return expected;
}
