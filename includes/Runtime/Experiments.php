<?php
/**
 * Registry and stored settings for Cortext experiments.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Runtime;

defined( 'ABSPATH' ) || exit;

use WP_Error;

final class Experiments {

	public const OPTION = 'cortext_experiments';

	/**
	 * Returns registered experiment metadata keyed by experiment ID.
	 *
	 * @return array<string,array{id:string,label:string,description:string,group:string,default:bool}>
	 */
	public function registered(): array {
		/**
		 * Filters registered Cortext experiments.
		 *
			 * Each experiment is an array with these keys:
			 * - id: required, unique, case-sensitive identifier. It must start with an ASCII
			 *   letter and contain only ASCII letters, digits, underscores, and hyphens.
			 * - label: optional name shown to users. Defaults to the ID.
			 * - description: optional description shown to users.
			 * - group: optional group name. Defaults to "Other".
			 * - default: optional initial enabled state. Defaults to false.
		 *
		 * @param array<int,array<string,mixed>> $experiments Registered experiments.
		 */
		$raw = apply_filters( 'cortext_experiments', array() );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$registered = array();
		foreach ( $raw as $experiment ) {
			if ( ! is_array( $experiment ) ) {
				continue;
			}
			$id = isset( $experiment['id'] ) && is_string( $experiment['id'] ) ? $experiment['id'] : '';
			if ( ! $this->is_valid_id( $id ) ) {
				continue;
			}
			$registered[ $id ] = array(
				'id'          => $id,
				'label'       => isset( $experiment['label'] ) ? (string) $experiment['label'] : $id,
				'description' => isset( $experiment['description'] ) ? (string) $experiment['description'] : '',
				'group'       => isset( $experiment['group'] ) ? (string) $experiment['group'] : __( 'Other', 'cortext' ),
				'default'     => isset( $experiment['default'] ) ? (bool) $experiment['default'] : false,
			);
		}

		return $registered;
	}

	public function is_enabled( string $id ): bool {
		$registered = $this->registered();
		if ( ! $this->is_valid_id( $id ) || ! isset( $registered[ $id ] ) ) {
			return false;
		}

		$stored = $this->stored_values( $registered );
		return $stored[ $id ] ?? $registered[ $id ]['default'];
	}

	/**
	 * Returns enabled state for client-side checks.
	 *
	 * @return array<string,bool>
	 */
	public function to_client_settings(): array {
		$out = array();
		foreach ( $this->list() as $experiment ) {
			$out[ $experiment['id'] ] = $experiment['enabled'];
		}
		return $out;
	}

	/**
	 * Returns registered experiments with resolved enabled states.
	 *
	 * @return array<int,array{id:string,label:string,description:string,group:string,enabled:bool}>
	 */
	public function list(): array {
		$registered = $this->registered();
		$stored     = $this->stored_values( $registered );
		$out        = array();

		foreach ( $registered as $id => $experiment ) {
			$out[] = array(
				'id'          => $id,
				'label'       => $experiment['label'],
				'description' => $experiment['description'],
				'group'       => $experiment['group'],
				'enabled'     => $stored[ $id ] ?? $experiment['default'],
			);
		}

		return $out;
	}

	/**
	 * Updates known experiment values.
	 *
	 * @param array<string,mixed> $enabled Experiment ID to enabled value.
	 * @return array<int,array{id:string,label:string,description:string,group:string,enabled:bool}>|WP_Error
	 */
	public function update( array $enabled ): array|WP_Error {
		$registered = $this->registered();
		$stored     = $this->stored_values( $registered );

		foreach ( $enabled as $id => $value ) {
			if ( ! is_string( $id ) || ! $this->is_valid_id( $id ) || ! isset( $registered[ $id ] ) ) {
				return new WP_Error(
					'cortext_experiments_unknown_id',
					__( "The request includes an experiment that isn't registered.", 'cortext' ),
					array( 'status' => 400 )
				);
			}
			$stored[ $id ] = (bool) $value;
		}

		update_option( self::OPTION, $stored, false );
		return $this->list();
	}

	/**
	 * Reads stored values and ignores experiments that are no longer registered.
	 *
	 * @param array<string,array{id:string,label:string,description:string,group:string,default:bool}> $registered Registered experiments.
	 * @return array<string,bool>
	 */
	private function stored_values( array $registered ): array {
		$raw = get_option( self::OPTION, array() );
		if ( ! is_array( $raw ) ) {
			return array();
		}

		$out = array();
		foreach ( $raw as $id => $value ) {
			if ( is_string( $id ) && $this->is_valid_id( $id ) && isset( $registered[ $id ] ) ) {
				$out[ $id ] = (bool) $value;
			}
		}
		return $out;
	}

	/**
	 * Validates an experiment ID without normalizing it.
	 *
	 * Experiment IDs are case-sensitive API keys. Requiring an ASCII letter as the
	 * first character prevents PHP from casting numeric string keys to integers.
	 *
	 * @param string $id Experiment ID.
	 */
	private function is_valid_id( string $id ): bool {
		return 1 === preg_match( '/\A[A-Za-z][A-Za-z0-9_-]*\z/', $id );
	}
}
