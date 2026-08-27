import { test, expect } from '../../src/fixtures/page.fixtures';
import { ApiHelper } from '../../src/helpers/api.helper';
import { epic, feature, story, severity, description } from 'allure-js-commons';

test.describe('Auth API @api @regression', () => {

  test('should login successfully via API', async ({ request }) => {
    await epic('Authentication');
    await feature('Auth API');
    await story('API Login');
    await severity('critical');
    await description('Verifies the login API returns a valid token with correct credentials');

    const api = new ApiHelper(request);
    const token = await api.login(
      process.env.TEST_USERNAME ?? '',
      process.env.TEST_PASSWORD ?? ''
    );

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });

  test('should reject login with invalid credentials via API', async ({ request }) => {
    await epic('Authentication');
    await feature('Auth API');
    await story('API Login Rejection');
    await severity('critical');
    await description('Verifies the login API returns 401 for invalid credentials');

    const response = await request.post('/web/index.php/api/v2/auth/login', {
      data: { username: 'invalid', password: 'wrongpassword' },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe('Users API @api @regression', () => {

  test('should fetch users list', async ({ apiHelper }) => {
    await epic('User Management');
    await feature('Users API');
    await story('List Users');
    await severity('normal');
    await description('Verifies the users API returns a list of users when authenticated');

    const response = await apiHelper.get('/web/index.php/api/v2/admin/users');
    await apiHelper.assertStatus(response, 200, 'GET users');

    const body = await apiHelper.assertJsonBody<{ data: unknown[] }>(response);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('should return 401 for unauthenticated request', async ({ request }) => {
    await epic('User Management');
    await feature('Users API');
    await story('Unauthenticated Access');
    await severity('critical');
    await description('Verifies the API returns 401 when accessed without a token');

    const response = await request.get('/web/index.php/api/v2/admin/users');
    expect(response.status()).toBe(401);
  });
});
