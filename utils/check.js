export const check = (req, db) => {
  const { id, email } = req.headers.cookie
  if (!id || !email) return { status: 401, message: 'Unauthorized' }
  db.get('SELECT * FROM users WHERE id = ? AND email = ?', [id, email], (err, row) => {
    if (err) {
      return {
        status: 500,
        message: 'Failed while getting email'
      }
    }
    if (!row) {
      return {
        status: 401,
        message: 'Unauthorized'
      }
    } else {
      return { id, email }
    }
  })
}
