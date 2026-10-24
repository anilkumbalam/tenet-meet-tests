const BASE_URL = process.env.BASE_URL

if (!BASE_URL) {
  throw new Error(
    'BASE_URL environment variable must be set explicitly, e.g.\n' +
    '  export BASE_URL=https://meet.tenetnetworks.com\n' +
    'Refusing to default — an incorrect silent default could cause ' +
    'API setup calls and browser navigation to target different servers.'
  )
}

module.exports = { BASE_URL }
