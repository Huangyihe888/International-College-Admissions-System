async function main() {
  const res = await fetch('http://localhost:3000/api/v1/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password' })
  });
  const data = await res.json();
  const token = data.data.accessToken;

  const listRes = await fetch('http://localhost:3000/api/v1/admin/analytics/feedbacks?range=7d&page=1&pageSize=20', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listData = await listRes.json();
  console.log("List Feedbacks:", JSON.stringify(listData, null, 2));
}
main();
