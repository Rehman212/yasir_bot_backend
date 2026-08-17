<?php
/**
 * Plugin Name: SheetPress SEO Bridge
 * Description: Lets SheetPress write Rank Math / Yoast SEO title, description, and focus keyword (REST meta is blocked by WordPress unless registered).
 * Version: 1.1.0
 * Author: SheetPress
 * Requires at least: 5.6
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
  exit;
}

/**
 * Register Rank Math / Yoast keys so WP REST can also update them after this plugin is active.
 */
add_action('init', function () {
  $keys = [
    'rank_math_title' => 'string',
    'rank_math_description' => 'string',
    'rank_math_focus_keyword' => 'string',
    '_yoast_wpseo_title' => 'string',
    '_yoast_wpseo_metadesc' => 'string',
    '_yoast_wpseo_focuskw' => 'string',
  ];

  foreach ($keys as $key => $type) {
    register_post_meta('post', $key, [
      'show_in_rest' => true,
      'single' => true,
      'type' => $type,
      'auth_callback' => function () {
        return current_user_can('edit_posts');
      },
    ]);
  }
});

add_action('rest_api_init', function () {
  register_rest_route('sheetpress/v1', '/seo/(?P<id>\d+)', [
    'methods' => 'POST',
    'callback' => 'sheetpress_update_seo_meta',
    'permission_callback' => function () {
      return current_user_can('edit_posts');
    },
    'args' => [
      'id' => [
        'required' => true,
        'type' => 'integer',
      ],
    ],
  ]);

  register_rest_route('sheetpress/v1', '/ping', [
    'methods' => 'GET',
    'callback' => function () {
      return [
        'ok' => true,
        'plugin' => 'sheetpress-seo-bridge',
        'version' => '1.1.0',
        'rank_math' => defined('RANK_MATH_VERSION') || class_exists('RankMath'),
        'yoast' => defined('WPSEO_VERSION'),
      ];
    },
    'permission_callback' => function () {
      return current_user_can('edit_posts');
    },
  ]);
});

/**
 * Write SEO meta using update_post_meta so Rank Math / Yoast UI can see it.
 */
function sheetpress_update_seo_meta(WP_REST_Request $request) {
  $post_id = (int) $request['id'];
  $post = get_post($post_id);

  if (!$post) {
    return new WP_Error('not_found', 'Post not found', ['status' => 404]);
  }

  if (!current_user_can('edit_post', $post_id)) {
    return new WP_Error('forbidden', 'Cannot edit this post', ['status' => 403]);
  }

  $json = $request->get_json_params();
  if (!is_array($json)) {
    $json = [];
  }

  $seo_title = $json['seoTitle'] ?? $request->get_param('seoTitle');
  $seo_description = $json['seoDescription'] ?? $request->get_param('seoDescription');
  $focus_keyword = $json['focusKeyword'] ?? $request->get_param('focusKeyword');

  $updated = [];

  if ($seo_title !== null && $seo_title !== '') {
    update_post_meta($post_id, 'rank_math_title', sanitize_text_field($seo_title));
    update_post_meta($post_id, '_yoast_wpseo_title', sanitize_text_field($seo_title));
    $updated[] = 'rank_math_title';
  }
  if ($seo_description !== null && $seo_description !== '') {
    update_post_meta($post_id, 'rank_math_description', sanitize_textarea_field($seo_description));
    update_post_meta($post_id, '_yoast_wpseo_metadesc', sanitize_textarea_field($seo_description));
    $updated[] = 'rank_math_description';
  }
  if ($focus_keyword !== null && $focus_keyword !== '') {
    update_post_meta($post_id, 'rank_math_focus_keyword', sanitize_text_field($focus_keyword));
    update_post_meta($post_id, '_yoast_wpseo_focuskw', sanitize_text_field($focus_keyword));
    $updated[] = 'rank_math_focus_keyword';
  }

  delete_post_meta($post_id, 'rank_math_seo_score');
  delete_post_meta($post_id, 'rank_math_internal_links_processed');

  return [
    'ok' => true,
    'postId' => $post_id,
    'updated' => array_values(array_unique($updated)),
    'values' => [
      'rank_math_title' => get_post_meta($post_id, 'rank_math_title', true),
      'rank_math_description' => get_post_meta($post_id, 'rank_math_description', true),
      'rank_math_focus_keyword' => get_post_meta($post_id, 'rank_math_focus_keyword', true),
    ],
  ];
}
