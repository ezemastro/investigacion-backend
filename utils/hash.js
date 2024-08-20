import crypto from 'node:crypto'

export const hash = (data) => {
  const hash = crypto.createHash('sha256')
  hash.update(data)
  return hash.digest('hex')
}
