# Planning Center API Setup

## Environment Variables

Create a `.env.local` file in your project root with the following variables:

```bash
# Planning Center API Credentials
PLANNING_CENTER_ID=your_planning_center_id_here
PLANNING_CENTER_TOKEN=your_planning_center_token_here

# Base URL for the application (used in API calls)
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

## Getting Your Planning Center Credentials

1. **Planning Center ID**: This is your organization's unique identifier
2. **Planning Center Token**: This is your personal access token

### To get your credentials:

1. Log into Planning Center Online
2. Go to your profile settings
3. Look for API or Developer settings
4. Generate a new access token
5. Note your organization ID

## API Integration Features

The app now dynamically fetches service types from Planning Center's API:

-   **Endpoint**: `https://api.planningcenteronline.com/services/v2/service_types`
-   **Authentication**: Basic Auth using your ID and token
-   **Data**: Service types are fetched server-side for optimal performance
-   **Fallback**: If the API fails, the app shows default service types

## Service Type Display

The app automatically:

-   Fetches all available service types from your Planning Center account
-   Filters out archived service types
-   Sorts by sequence order
-   Assigns appropriate emojis based on service type names
-   Shows frequency information (Weekly, Monthly, etc.)

## Development

-   **Server-side rendering**: Service types are fetched during build/request time
-   **No caching**: Fresh data on each request
-   **Error handling**: Graceful fallback if API is unavailable
-   **TypeScript**: Full type safety for API responses

## Testing

1. Set up your `.env.local` file
2. Run `npm run dev`
3. The app will fetch real service types from Planning Center
4. Select any service type to see the plans table
