export const check = (req, db) => {
  let exist, survey, trivia
  return new Promise((resolve, reject) => {
    if (!req.headers.cookie) resolve({ exist: false })
    const { id, email } = req.cookies
    if (!id || !email) resolve({ exist: false })
    db.serialize(() => {
      db.get('SELECT * FROM users WHERE user_id = ? AND email = ?', [id, email], (err, row) => {
        if (err) {
          resolve({
            err: true,
            status: 500,
            message: 'Failed while getting email'
          })
        }
        if (!row) {
          resolve({ exist: false })
        } else {
          exist = true
          if (!row.bonus_category_id) resolve({ email, id, exist, survey, trivia })
          trivia = true
        }
      })
      db.get('SELECT COUNT(*) FROM survey_responses WHERE user_id = ?', [id], (err, row) => {
        if (err) resolve({ err: true, status: 500, message: 'Failed while getting survey' })
        if (row) survey = true
        resolve({ email, id, exist, survey, trivia })
      })
    })
  })
}
